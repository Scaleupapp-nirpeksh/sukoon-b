const DrugInteraction = require('../models/DrugInteraction');
const Medication = require('../models/medicationModel');
const crypto = require('crypto');
const logger = require('../utils/logger');
const { OpenAI } = require('openai');

// Initialize OpenAI API
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Check for drug interactions between medications
 * @route POST /api/medications/interactions/check
 */
exports.checkDrugInteractions = async (req, res) => {
  try {
    let { medications } = req.body;
    
    // If medications not provided, get user's active medications
    if (!medications || !Array.isArray(medications) || medications.length === 0) {
      const userMedications = await Medication.find({
        userId: req.user._id,
        isActive: true,
        status: 'active'
      });
      
      medications = userMedications.map(med => ({
        id: med._id,
        name: med.genericName || med.name
      }));
    }
    
    // Ensure we have at least 2 medications to check
    if (!medications || medications.length < 2) {
      return res.status(400).json({
        status: 'error',
        message: 'At least two medications are required for interaction check'
      });
    }
    
    // Extract medication names
    const medicationNames = medications.map(med => med.name || med.genericName || med);
    
    // Sort names alphabetically for consistent hashing
    const sortedNames = [...medicationNames].sort();
    
    // Create a hash for caching
    const medicationHash = crypto
      .createHash('md5')
      .update(sortedNames.join('|').toLowerCase())
      .digest('hex');
    
    // Check cache first
    let interactionResult = await DrugInteraction.findOne({ medicationHash });
    
    // If found in cache and not expired
    if (interactionResult) {
      return res.status(200).json({
        status: 'success',
        source: 'cache',
        medications: interactionResult.medications,
        interactions: interactionResult.interactions,
        overallSeverity: interactionResult.overallSeverity,
        recommendations: interactionResult.recommendations,
        disclaimer: interactionResult.disclaimer,
        timestamp: interactionResult.updatedAt
      });
    }
    
    // Not in cache, use OpenAI to check interactions
    interactionResult = await checkInteractionsWithOpenAI(sortedNames);
    
    // Cache the result
    const interaction = new DrugInteraction({
      medicationHash,
      medications: sortedNames,
      interactions: interactionResult.interactions,
      overallSeverity: interactionResult.overallSeverity,
      recommendations: interactionResult.recommendations,
      aiModel: interactionResult.model,
      disclaimer: "This information is provided for reference only and may not include the most recent research. Please consult with a healthcare professional before making any decisions regarding your medications."
    });
    
    await interaction.save();
    
    res.status(200).json({
      status: 'success',
      source: 'openai',
      medications: sortedNames,
      interactions: interactionResult.interactions,
      overallSeverity: interactionResult.overallSeverity,
      recommendations: interactionResult.recommendations,
      disclaimer: interaction.disclaimer,
      timestamp: new Date()
    });
  } catch (error) {
    logger.error('Error checking drug interactions:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to check drug interactions',
      error: process.env.NODE_ENV === 'development' ? error.message : 'An unexpected error occurred'
    });
  }
};

/**
 * Get cached drug interactions for a medication
 * @route GET /api/medications/:id/interactions
 */
exports.getMedicationInteractions = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if medication exists and belongs to user
    const medication = await Medication.findOne({
      _id: id,
      userId: req.user._id
    });
    
    if (!medication) {
      return res.status(404).json({
        status: 'error',
        message: 'Medication not found'
      });
    }
    
    // Get user's other active medications
   const otherMedications = await Medication.find({
    userId: req.user._id,
    isActive: true,
    _id: { $ne: id }
  });
  
  if (otherMedications.length === 0) {
    return res.status(200).json({
      status: 'success',
      message: 'No other medications found to check for interactions',
      interactions: []
    });
  }
  
  // Get medication names
  const medicationName = medication.genericName || medication.name;
  const otherMedicationNames = otherMedications.map(med => med.genericName || med.name);
  
  // Get all combinations with this medication
  const interactionResults = [];
  
  for (const otherMed of otherMedicationNames) {
    // Sort names for consistent hashing
    const sortedNames = [medicationName, otherMed].sort();
    
    // Create hash
    const medicationHash = crypto
      .createHash('md5')
      .update(sortedNames.join('|').toLowerCase())
      .digest('hex');
    
    // Check cache
    const interactionResult = await DrugInteraction.findOne({ 
      medicationHash,
      medications: { $all: sortedNames }
    });
    
    if (interactionResult) {
      // Filter interactions to only include those with this medication
      const relevantInteractions = interactionResult.interactions.filter(interaction => 
        interaction.medications.includes(medicationName)
      );
      
      if (relevantInteractions.length > 0) {
        interactionResults.push({
          otherMedication: otherMed,
          interactions: relevantInteractions,
          severity: getMaxSeverity(relevantInteractions)
        });
      }
    }
  }
  
  // If no interactions found, check with OpenAI
  if (interactionResults.length === 0) {
    const allMedicationNames = [medicationName, ...otherMedicationNames];
    const interactionResult = await checkInteractionsWithOpenAI(allMedicationNames);
    
    // Process and cache results
    for (const interaction of interactionResult.interactions) {
      // Only process interactions involving this medication
      if (interaction.medications.includes(medicationName)) {
        const otherMed = interaction.medications.find(med => med !== medicationName);
        
        if (otherMed) {
          // Sort names for consistent hashing
          const sortedNames = [medicationName, otherMed].sort();
          
          // Create hash
          const medicationHash = crypto
            .createHash('md5')
            .update(sortedNames.join('|').toLowerCase())
            .digest('hex');
          
          // Cache the interaction
          const interactionDoc = new DrugInteraction({
            medicationHash,
            medications: sortedNames,
            interactions: [interaction],
            overallSeverity: interaction.severity,
            recommendations: interactionResult.recommendations.filter(rec => 
              rec.toLowerCase().includes(medicationName.toLowerCase()) || 
              rec.toLowerCase().includes(otherMed.toLowerCase())
            ),
            aiModel: interactionResult.model,
            disclaimer: "This information is provided for reference only and may not include the most recent research. Please consult with a healthcare professional before making any decisions regarding your medications."
          });
          
          await interactionDoc.save();
          
          interactionResults.push({
            otherMedication: otherMed,
            interactions: [interaction],
            severity: interaction.severity
          });
        }
      }
    }
  }
  
  // Sort by severity
  interactionResults.sort((a, b) => {
    const severityOrder = { severe: 3, moderate: 2, mild: 1, none: 0 };
    return severityOrder[b.severity] - severityOrder[a.severity];
  });
  
  res.status(200).json({
    status: 'success',
    medication: medicationName,
    interactionCount: interactionResults.length,
    interactionResults,
    disclaimer: "This information is provided for reference only and may not include the most recent research. Please consult with a healthcare professional before making any decisions regarding your medications."
  });
} catch (error) {
  logger.error('Error getting medication interactions:', error);
  res.status(500).json({
    status: 'error',
    message: 'Failed to get medication interactions',
    error: process.env.NODE_ENV === 'development' ? error.message : 'An unexpected error occurred'
  });
}
};

/**
* Check for drug interactions using OpenAI
*/
async function checkInteractionsWithOpenAI(medicationNames) {
try {
  const prompt = `
    As a healthcare assistant, please analyze the potential drug interactions between the following medications:
    ${medicationNames.join(", ")}
    
    For each potential interaction, provide:
    1. The two medications involved
    2. The severity (none, mild, moderate, or severe)
    3. A brief description of the interaction
    4. Recommendations for managing the interaction
    
    Please format your response as a JSON object with the following structure:
    {
      "interactions": [
        {
          "medications": ["medication1", "medication2"],
          "severity": "mild/moderate/severe",
          "description": "Brief description of the interaction",
          "recommendations": ["Recommendation 1", "Recommendation 2"]
        }
      ],
      "overallSeverity": "mild/moderate/severe",
      "recommendations": ["General recommendation 1", "General recommendation 2"]
    }
    
    Only include interactions that are clinically significant. If there are no known interactions, return an empty array for 'interactions' and 'none' for 'overallSeverity'.
  `;
  
  const completion = await openai.chat.completions.create({
    model: "gpt-3.5-turbo",
    messages: [
      { 
        role: "system", 
        content: "You are a healthcare assistant with knowledge of drug interactions. Provide factual information about potential interactions between medications. Always include a disclaimer that this information should be verified with a healthcare provider."
      },
      { role: "user", content: prompt }
    ],
    temperature: 0.3,
    max_tokens: 1000,
    response_format: { type: "json_object" }
  });
  
  const responseText = completion.choices[0].message.content;
  const responseData = JSON.parse(responseText);
  
  // Add model info
  responseData.model = completion.model;
  
  return responseData;
} catch (error) {
  logger.error('Error checking interactions with OpenAI:', error);
  
  // Return a fallback response
  return {
    interactions: [],
    overallSeverity: 'unknown',
    recommendations: [
      "Unable to check drug interactions at this time.",
      "Please consult with your healthcare provider or pharmacist regarding potential interactions between your medications."
    ],
    model: "fallback"
  };
}
}

/**
* Get the maximum severity from a list of interactions
*/
function getMaxSeverity(interactions) {
const severityOrder = { severe: 3, moderate: 2, mild: 1, none: 0, unknown: -1 };
let maxSeverity = 'none';

for (const interaction of interactions) {
  if (severityOrder[interaction.severity] > severityOrder[maxSeverity]) {
    maxSeverity = interaction.severity;
  }
}

return maxSeverity;
}