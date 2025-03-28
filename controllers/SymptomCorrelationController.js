// controllers/SymptomCorrelationController.js
const mongoose = require('mongoose');
const SymptomCorrelationService = require('../services/symptomCorrelationService');
const Medication = require('../models/medicationModel');
const logger = require('../utils/logger');
const { OpenAI } = require('openai');

// Initialize OpenAI API
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Initialize the correlation service
const correlationService = new SymptomCorrelationService();

/**
 * Get symptom-medication correlations
 * @route GET /api/health/symptom-correlations
 */
exports.getSymptomCorrelations = async (req, res) => {
  try {
    const { timeframeInDays = 90, medicationId, symptomName, includeDetails = 'false' } = req.query;
    
    // Validate params
    if (medicationId) {
      // Verify medication belongs to user
      const medication = await Medication.findOne({
        _id: medicationId,
        $or: [
          { userId: req.user._id },
          { sharedWith: req.user._id }
        ]
      });
      
      if (!medication) {
        return res.status(404).json({
          status: 'error',
          message: 'Medication not found or you do not have access to it'
        });
      }
    }
    
    // Get correlations
    const correlations = await correlationService.analyzeCorrelations(
      req.user._id.toString(),
      {
        timeframeInDays: parseInt(timeframeInDays),
        medicationId,
        symptomName
      }
    );
    
    // Generate summary insights using AI
    let aiInsights = [];
    let shouldGenerateAI = correlations.medicationSymptomCorrelations.length > 0 || 
                          correlations.temporalPatterns.length > 0;
                          
    if (shouldGenerateAI && process.env.NODE_ENV !== 'development') {
      aiInsights = await generateAIInsights(correlations);
    } else if (shouldGenerateAI) {
      // Development mode - provide sample insights
      aiInsights = generateSampleInsights(correlations);
    }
    
    // If includeDetails is false, remove detailed data points
    if (includeDetails !== 'true') {
      // Filter out excessive details
      if (correlations.medicationSymptomCorrelations) {
        correlations.medicationSymptomCorrelations = correlations.medicationSymptomCorrelations.map(corr => {
          const { overlap, ...rest } = corr;
          return rest;
        });
      }
      
      if (correlations.temporalPatterns) {
        correlations.temporalPatterns = correlations.temporalPatterns.map(pattern => {
          const newPattern = { ...pattern };
          if (newPattern.onsetPatterns) {
            delete newPattern.onsetPatterns.examples;
          }
          if (newPattern.offsetPatterns) {
            delete newPattern.offsetPatterns.examples;
          }
          return newPattern;
        });
      }
      
      // Remove large network data if present
      if (correlations.symptomNetworkAnalysis && 
          correlations.symptomNetworkAnalysis.nodes && 
          correlations.symptomNetworkAnalysis.nodes.length > 10) {
        // Truncate to top 10 nodes
        correlations.symptomNetworkAnalysis.nodes = 
          correlations.symptomNetworkAnalysis.nodes.slice(0, 10);
      }
    }
    
    // Prepare response
    res.status(200).json({
      status: 'success',
      timeframeInDays: parseInt(timeframeInDays),
      correlations,
      insights: aiInsights
    });
  } catch (error) {
    logger.error('Error getting symptom correlations:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get symptom correlations',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Get detailed analysis for a specific medication-symptom pair
 * @route GET /api/health/symptom-correlations/detailed
 */
exports.getDetailedCorrelation = async (req, res) => {
  try {
    const { medicationId, symptomName, timeframeInDays = 90 } = req.query;
    
    // Validate required parameters
    if (!medicationId || !symptomName) {
      return res.status(400).json({
        status: 'error',
        message: 'Medication ID and symptom name are required'
      });
    }
    
    // Verify medication belongs to user
    const medication = await Medication.findOne({
      _id: medicationId,
      $or: [
        { userId: req.user._id },
        { sharedWith: req.user._id }
      ]
    });
    
    if (!medication) {
      return res.status(404).json({
        status: 'error',
        message: 'Medication not found or you do not have access to it'
      });
    }
    
    // Get correlations focused on this medication-symptom pair
    const results = await correlationService.analyzeCorrelations(
      req.user._id.toString(),
      {
        timeframeInDays: parseInt(timeframeInDays),
        medicationId,
        symptomName
      }
    );
    
    // Find the specific correlation
    const specificCorrelation = results.medicationSymptomCorrelations.find(
      corr => corr.medicationId === medicationId && 
              corr.symptomName.toLowerCase() === symptomName.toLowerCase()
    );
    
    const specificPattern = results.temporalPatterns.find(
      pattern => pattern.medicationId === medicationId && 
                 pattern.symptomName.toLowerCase() === symptomName.toLowerCase()
    );
    
    const specificEfficacy = results.medicationEfficacyCorrelations.find(
      eff => eff.medicationId === medicationId && 
             eff.symptomEffectiveness.some(s => 
               s.symptomName.toLowerCase() === symptomName.toLowerCase()
             )
    );
    
    // Generate detailed insights with AI
    let detailedInsights = [];
    
    if (specificCorrelation || specificPattern || specificEfficacy) {
      if (process.env.NODE_ENV !== 'development') {
        detailedInsights = await generateDetailedAIInsights(
          medication.name, 
          symptomName,
          specificCorrelation,
          specificPattern,
          specificEfficacy
        );
      } else {
        // Development mode - provide sample insights
        detailedInsights = [
          `Analysis of ${medication.name} and ${symptomName} shows a ${specificCorrelation?.strength || 'weak'} correlation.`,
          specificPattern?.interpretation || `No clear temporal pattern detected between ${medication.name} and ${symptomName}.`,
          `Consider tracking more data points to improve analysis accuracy.`
        ];
      }
    }
    
    res.status(200).json({
      status: 'success',
      medicationName: medication.name,
      symptomName,
      timeframeInDays: parseInt(timeframeInDays),
      correlation: specificCorrelation || null,
      temporalPattern: specificPattern || null,
      efficacy: specificEfficacy ? {
        medicationId: specificEfficacy.medicationId,
        medicationName: specificEfficacy.medicationName,
        averageEfficacy: specificEfficacy.averageEfficacy,
        specificSymptom: specificEfficacy.symptomEffectiveness.find(
          s => s.symptomName.toLowerCase() === symptomName.toLowerCase()
        )
      } : null,
      insights: detailedInsights,
      dataPointsSummary: results.dataPoints
    });
  } catch (error) {
    logger.error('Error getting detailed correlation:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get detailed correlation',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Get symptom network visualization data
 * @route GET /api/health/symptom-network
 */
exports.getSymptomNetwork = async (req, res) => {
  try {
    const { timeframeInDays = 90 } = req.query;
    
    // Get correlations with focus on network analysis
    const results = await correlationService.analyzeCorrelations(
      req.user._id.toString(),
      {
        timeframeInDays: parseInt(timeframeInDays)
      }
    );
    
    // Return just the network analysis part
    res.status(200).json({
      status: 'success',
      timeframeInDays: parseInt(timeframeInDays),
      network: results.symptomNetworkAnalysis,
      dataPointsSummary: results.dataPoints
    });
  } catch (error) {
    logger.error('Error getting symptom network:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get symptom network',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Generate insights using OpenAI
 * @private
 */
async function generateAIInsights(correlationData) {
  try {
    // Prepare data summary for OpenAI
    const medicationCount = Object.keys(correlationData.dataPoints.medications).length;
    const symptomCount = Object.keys(correlationData.dataPoints.symptoms).length;
    
    // Get top correlations
    const topCorrelations = correlationData.medicationSymptomCorrelations
      .slice(0, 3)
      .map(c => ({
        medication: c.medicationName,
        symptom: c.symptomName,
        correlation: c.correlation,
        direction: c.direction,
        strength: c.strength
      }));
      
    // Get top temporal patterns
    const topPatterns = correlationData.temporalPatterns
      .slice(0, 3)
      .map(p => ({
        medication: p.medicationName,
        symptom: p.symptomName,
        interpretation: p.interpretation
      }));
    
    // Prepare prompt with relevant data
    const prompt = `
      Based on the following health data analysis, provide 3-5 clear, actionable insights about medication and symptom correlations:
      
      Data summary:
      - ${medicationCount} medications and ${symptomCount} symptoms analyzed over ${correlationData.dataPoints.dateRange.start} to ${correlationData.dataPoints.dateRange.end}
      
      Top correlations:
      ${JSON.stringify(topCorrelations, null, 2)}
      
      Top temporal patterns:
      ${JSON.stringify(topPatterns, null, 2)}
      
      Your insights should be:
      1. Written in plain language that a patient can understand
      2. Balanced (avoid alarming language)
      3. Clear about correlation vs. causation
      4. Actionable where possible
      
      Format your response as a JSON array of insight strings.
    `;
    
    // Call OpenAI
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { 
          role: "system", 
          content: "You are a health analytics assistant that provides clear, balanced insights about medication and symptom patterns."
        },
        { role: "user", content: prompt }
      ],
      temperature: 0.5,
      max_tokens: 600
    });
    
    // Parse response
    const responseText = completion.choices[0].message.content.trim();
    
    try {
      return JSON.parse(responseText);
    } catch (parseError) {
      logger.error('Error parsing AI insights:', parseError);
      
      // Fall back to extracting insights from non-JSON response
      return extractInsightsFromText(responseText);
    }
  } catch (error) {
    logger.error('Error generating AI insights:', error);
    return generateSampleInsights(correlationData);
  }
}

/**
 * Generate detailed insights for a specific medication-symptom pair
 * @private
 */
async function generateDetailedAIInsights(medicationName, symptomName, correlation, pattern, efficacy) {
  try {
    // Prepare data for OpenAI
    const correlationData = correlation ? 
      `Correlation: ${correlation.strength} ${correlation.direction} correlation (${correlation.correlation})` : 
      'No significant correlation detected';
    
    const patternData = pattern?.interpretation || 'No clear temporal pattern detected';
    
    const efficacyData = efficacy ? 
      `Average efficacy rating: ${efficacy.averageEfficacy}/5` : 
      'No efficacy data available';
      
    // Prepare prompt
    const prompt = `
      Provide 3-5 detailed, actionable insights about the relationship between ${medicationName} and ${symptomName} based on the following analysis:
      
      ${correlationData}
      ${patternData}
      ${efficacyData}
      
      Your insights should:
      1. Be specific to this medication-symptom pair
      2. Explain what the correlation means in practical terms
      3. Suggest potential next steps or things to monitor
      4. Be clear about correlation vs. causation
      5. Use accessible language a patient can understand
      
      Format your response as a JSON array of insight strings.
    `;
    
    // Call OpenAI
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { 
          role: "system", 
          content: "You are a health analytics assistant that provides clear, balanced insights about medication and symptom relationships."
        },
        { role: "user", content: prompt }
      ],
      temperature: 0.5,
      max_tokens: 600
    });
    
    // Parse response
    const responseText = completion.choices[0].message.content.trim();
    
    try {
      return JSON.parse(responseText);
    } catch (parseError) {
      logger.error('Error parsing AI detailed insights:', parseError);
      
      // Fall back to extracting insights from non-JSON response
      return extractInsightsFromText(responseText);
    }
  } catch (error) {
    logger.error('Error generating detailed AI insights:', error);
    return [
      `Analysis shows a relationship between ${medicationName} and ${symptomName} that may be worth monitoring.`,
      `Consider tracking more data points and discussing this pattern with your healthcare provider.`,
      `Remember that correlation doesn't necessarily mean causation - other factors may be involved.`
    ];
  }
}

/**
 * Extract insights from non-JSON text
 * @private
 */
function extractInsightsFromText(text) {
  // Try to extract numbered points or bullet points
  const numberedRegex = /\d+\.\s+(.*?)(?=\d+\.|$)/gs;
  const bulletRegex = /[•\-\*]\s+(.*?)(?=[•\-\*]|$)/gs;
  
  let matches = [...text.matchAll(numberedRegex)].map(m => m[1].trim());
  
  if (matches.length === 0) {
    matches = [...text.matchAll(bulletRegex)].map(m => m[1].trim());
  }
  
  if (matches.length === 0) {
    // Fall back to splitting by newlines
    matches = text.split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 20 && !line.startsWith('```'));
  }
  
  return matches.length > 0 ? matches : [text];
}

/**
 * Generate sample insights for development mode
 * @private
 */
function generateSampleInsights(correlationData) {
  const insights = [
    "Based on your tracking data, there appear to be some potential relationships between certain medications and symptoms that may be worth monitoring.",
    "Remember that correlation doesn't necessarily mean causation - other factors like diet, stress, or sleep may also influence your symptoms."
  ];
  
  const topCorrelation = correlationData.medicationSymptomCorrelations[0];
  if (topCorrelation) {
    if (topCorrelation.direction === 'positive') {
      insights.push(`There appears to be a ${topCorrelation.strength} relationship between ${topCorrelation.medicationName} and ${topCorrelation.symptomName}. Consider discussing this with your healthcare provider.`);
    } else {
      insights.push(`${topCorrelation.medicationName} may help reduce ${topCorrelation.symptomName}, though more tracking could help confirm this pattern.`);
    }
  }
  
  const topPattern = correlationData.temporalPatterns[0];
  if (topPattern && topPattern.interpretation) {
    insights.push(topPattern.interpretation);
  }
  
  return insights;
}

module.exports = exports;