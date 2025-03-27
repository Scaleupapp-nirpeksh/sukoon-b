const mongoose = require('mongoose');
const MedicationEfficacy = require('../models/MedicationEfficacy');
const Medication = require('../models/medicationModel');
const SideEffect = require('../models/SideEffect');
const { HealthCheckIn } = require('../models/healthModel');
const logger = require('../utils/logger');
const { OpenAI } = require('openai');

// Initialize OpenAI API for insights
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Record medication efficacy
 * @route POST /api/medications/:id/efficacy
 */
exports.recordEfficacy = async (req, res) => {
  try {
    const { 
      symptomRelief, 
      sideEffects, 
      effectDuration, 
      timeToEffect, 
      overallRating, 
      notes,
      targetSymptoms
    } = req.body;
    
    // Validate medication access
    const medication = await Medication.findOne({
      _id: req.params.id,
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
    
    // Validate required fields
    if (!overallRating) {
      return res.status(400).json({
        status: 'error',
        message: 'Overall rating is required'
      });
    }
    
    // Create new efficacy record
    const efficacy = new MedicationEfficacy({
      userId: medication.userId,
      medicationId: medication._id,
      symptomRelief,
      sideEffects: sideEffects || [],
      effectDuration,
      timeToEffect,
      overallRating,
      notes,
      recordedAt: new Date(),
      targetSymptoms: targetSymptoms || []
    });
    
    await efficacy.save();
    
    // Update medication's efficacy rating (average of last 5 ratings)
    const recentEfficacyReports = await MedicationEfficacy.find({
      medicationId: medication._id
    })
    .sort({ recordedAt: -1 })
    .limit(5);
    
    if (recentEfficacyReports.length > 0) {
      const avgRating = recentEfficacyReports.reduce((sum, report) => 
        sum + report.overallRating, 0) / recentEfficacyReports.length;
      
      await Medication.findByIdAndUpdate(medication._id, {
        efficacyRating: Math.round(avgRating * 10) / 10 // Round to 1 decimal
      });
    }
    
    // If new side effects were reported, record them in the SideEffect collection
    if (sideEffects && sideEffects.length > 0) {
      for (const effect of sideEffects) {
        // Check if this side effect was already recorded for this medication
        const existingSideEffect = await SideEffect.findOne({
          userId: medication.userId,
          medicationId: medication._id,
          effect: effect.effect,
          status: 'active'
        });
        
        if (existingSideEffect) {
          // Update existing side effect record if severity changed
          if (existingSideEffect.severity !== effect.severity) {
            existingSideEffect.severity = effect.severity;
            existingSideEffect.characteristics = effect.characteristics || existingSideEffect.characteristics;
            await existingSideEffect.save();
          }
        } else {
          // Create new side effect record
          const sideEffect = new SideEffect({
            userId: medication.userId,
            medicationId: medication._id,
            effect: effect.effect,
            severity: effect.severity,
            onset: new Date(),
            status: 'active',
            bodyLocation: effect.bodyLocation,
            characteristics: effect.characteristics,
            description: effect.notes,
            interferesWith: effect.interferesWith || []
          });
          
          await sideEffect.save();
        }
      }
    }
    
    res.status(201).json({
      status: 'success',
      message: 'Medication efficacy recorded successfully',
      efficacy: {
        id: efficacy._id,
        overallRating: efficacy.overallRating,
        recordedAt: efficacy.recordedAt
      }
    });
  } catch (error) {
    logger.error('Error recording medication efficacy:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to record medication efficacy',
      error: process.env.NODE_ENV === 'development' ? error.message : 'An unexpected error occurred'
    });
  }
};

/**
 * Get efficacy history for a medication
 * @route GET /api/medications/:id/efficacy
 */
exports.getEfficacyHistory = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    
    // Validate medication access
    const medication = await Medication.findOne({
      _id: req.params.id,
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
    
    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Get efficacy records
    const efficacyRecords = await MedicationEfficacy.find({
      medicationId: medication._id
    })
    .sort({ recordedAt: -1 })
    .skip(skip)
    .limit(parseInt(limit));
    
    // Get total count for pagination
    const total = await MedicationEfficacy.countDocuments({
      medicationId: medication._id
    });
    
    res.status(200).json({
      status: 'success',
      count: efficacyRecords.length,
      total,
      pages: Math.ceil(total / parseInt(limit)),
      currentPage: parseInt(page),
      efficacyRecords
    });
  } catch (error) {
    logger.error('Error getting medication efficacy history:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get medication efficacy history',
      error: process.env.NODE_ENV === 'development' ? error.message : 'An unexpected error occurred'
    });
  }
};

/**
 * Get efficacy summary for a medication
 * @route GET /api/medications/:id/efficacy/summary
 */
exports.getEfficacySummary = async (req, res) => {
  try {
    // Validate medication access
    const medication = await Medication.findOne({
      _id: req.params.id,
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
    
    // Get all efficacy records for this medication
    const efficacyRecords = await MedicationEfficacy.find({
      medicationId: medication._id
    }).sort({ recordedAt: -1 });
    
    if (efficacyRecords.length === 0) {
      return res.status(200).json({
        status: 'success',
        message: 'No efficacy data available for this medication',
        summary: null
      });
    }
    
    // Calculate summary statistics
    const summary = {
      recordsCount: efficacyRecords.length,
      averageRating: 0,
      averageTimeToEffect: 0,
      averageEffectDuration: 0,
      sideEffects: [],
      targetSymptoms: [],
      ratingDistribution: {
        excellent: 0, // 5
        good: 0,      // 4
        moderate: 0,  // 3
        fair: 0,      // 2
        poor: 0       // 1
      },
      trend: 'stable', // improving, declining, or stable
      firstRecorded: efficacyRecords[efficacyRecords.length - 1].recordedAt,
      lastRecorded: efficacyRecords[0].recordedAt
    };
    
    // Calculate average rating
    const totalRating = efficacyRecords.reduce((sum, record) => sum + record.overallRating, 0);
    summary.averageRating = Math.round((totalRating / efficacyRecords.length) * 10) / 10;
    
    // Calculate average time to effect (if available)
    const recordsWithTimeToEffect = efficacyRecords.filter(record => record.timeToEffect);
    if (recordsWithTimeToEffect.length > 0) {
      const totalTimeToEffect = recordsWithTimeToEffect.reduce((sum, record) => sum + record.timeToEffect, 0);
      summary.averageTimeToEffect = Math.round(totalTimeToEffect / recordsWithTimeToEffect.length);
    } else {
      summary.averageTimeToEffect = null;
    }
    
    // Calculate average effect duration (if available)
    const recordsWithDuration = efficacyRecords.filter(record => record.effectDuration);
    if (recordsWithDuration.length > 0) {
      const totalDuration = recordsWithDuration.reduce((sum, record) => sum + record.effectDuration, 0);
      summary.averageEffectDuration = Math.round(totalDuration / recordsWithDuration.length);
    } else {
      summary.averageEffectDuration = null;
    }
    
    // Calculate rating distribution
    efficacyRecords.forEach(record => {
      switch(Math.round(record.overallRating)) {
        case 5: summary.ratingDistribution.excellent++; break;
        case 4: summary.ratingDistribution.good++; break;
        case 3: summary.ratingDistribution.moderate++; break;
        case 2: summary.ratingDistribution.fair++; break;
        case 1: summary.ratingDistribution.poor++; break;
      }
    });
    
    // Calculate percentages for rating distribution
    Object.keys(summary.ratingDistribution).forEach(key => {
      summary.ratingDistribution[key] = Math.round((summary.ratingDistribution[key] / efficacyRecords.length) * 100);
    });
    
    // Determine trend (if we have enough data)
    if (efficacyRecords.length >= 3) {
      // Compare first half with second half
      const midpoint = Math.floor(efficacyRecords.length / 2);
      const recentRecords = efficacyRecords.slice(0, midpoint);
      const olderRecords = efficacyRecords.slice(midpoint);
      
      const recentAvg = recentRecords.reduce((sum, record) => sum + record.overallRating, 0) / recentRecords.length;
      const olderAvg = olderRecords.reduce((sum, record) => sum + record.overallRating, 0) / olderRecords.length;
      
      const difference = recentAvg - olderAvg;
      
      if (difference >= 0.5) {
        summary.trend = 'improving';
      } else if (difference <= -0.5) {
        summary.trend = 'declining';
      } else {
        summary.trend = 'stable';
      }
    }
    
    // Compile side effects
    const sideEffectsMap = {};
    
    efficacyRecords.forEach(record => {
      if (record.sideEffects && record.sideEffects.length > 0) {
        record.sideEffects.forEach(effect => {
          const effectName = effect.effect;
          
          if (!sideEffectsMap[effectName]) {
            sideEffectsMap[effectName] = {
              effect: effectName,
              occurrenceCount: 1,
              averageSeverity: effect.severity || 0,
              firstReported: record.recordedAt
            };
          } else {
            sideEffectsMap[effectName].occurrenceCount++;
            sideEffectsMap[effectName].averageSeverity = 
              (sideEffectsMap[effectName].averageSeverity * (sideEffectsMap[effectName].occurrenceCount - 1) + 
              (effect.severity || 0)) / sideEffectsMap[effectName].occurrenceCount;
          }
        });
      }
    });
    
    // Sort side effects by occurrence count
    summary.sideEffects = Object.values(sideEffectsMap)
      .sort((a, b) => b.occurrenceCount - a.occurrenceCount)
      .map(effect => ({
        ...effect,
        averageSeverity: Math.round(effect.averageSeverity * 10) / 10, // Round to 1 decimal
        occurrencePercentage: Math.round((effect.occurrenceCount / efficacyRecords.length) * 100)
      }));
    
    // Compile target symptoms
    const symptomsMap = {};
    
    efficacyRecords.forEach(record => {
      if (record.targetSymptoms && record.targetSymptoms.length > 0) {
        record.targetSymptoms.forEach(symptom => {
          const symptomName = symptom.name;
          
          if (!symptomsMap[symptomName]) {
            symptomsMap[symptomName] = {
              name: symptomName,
              occurrenceCount: 1,
              totalImprovement: symptom.improvementRating || 0,
              averageImprovement: symptom.improvementRating || 0
            };
          } else {
            symptomsMap[symptomName].occurrenceCount++;
            symptomsMap[symptomName].totalImprovement += (symptom.improvementRating || 0);
            symptomsMap[symptomName].averageImprovement = 
              Math.round((symptomsMap[symptomName].totalImprovement / symptomsMap[symptomName].occurrenceCount) * 10) / 10;
          }
        });
      }
    });
    
    // Sort symptoms by occurrence count
    summary.targetSymptoms = Object.values(symptomsMap)
      .sort((a, b) => b.occurrenceCount - a.occurrenceCount)
      .map(symptom => ({
        ...symptom,
        occurrencePercentage: Math.round((symptom.occurrenceCount / efficacyRecords.length) * 100)
      }));
    
    res.status(200).json({
      status: 'success',
      summary
    });
  } catch (error) {
    logger.error('Error getting medication efficacy summary:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get medication efficacy summary',
      error: process.env.NODE_ENV === 'development' ? error.message : 'An unexpected error occurred'
    });
  }
};

/**
 * Compare efficacy across multiple medications
 * @route GET /api/medications/efficacy/compare
 */
exports.compareEfficacy = async (req, res) => {
  try {
    const { medicationIds, symptom } = req.query;
    
    if (!medicationIds) {
      return res.status(400).json({
        status: 'error',
        message: 'Medication IDs are required for comparison'
      });
    }
    
    // Parse medication IDs
    const idsArray = medicationIds.split(',');
    
    // Validate medication access for each ID
    const medications = await Medication.find({
      _id: { $in: idsArray },
      $or: [
        { userId: req.user._id },
        { sharedWith: req.user._id }
      ]
    });
    
    if (medications.length === 0) {
      return res.status(404).json({
        status: 'error',
        message: 'No valid medications found for comparison'
      });
    }
    
    // Get medication IDs that user has access to
    const accessibleIds = medications.map(med => med._id);
    
    // Prepare comparison results
    const comparison = await Promise.all(accessibleIds.map(async (medId) => {
      const medication = medications.find(m => m._id.toString() === medId.toString());
      
      // Get efficacy records for this medication
      let efficacyQuery = { medicationId: medId };
      
      // If symptom is specified, filter for that symptom
      if (symptom) {
        efficacyQuery['targetSymptoms.name'] = symptom;
      }
      
      const efficacyRecords = await MedicationEfficacy.find(efficacyQuery);
      
      if (efficacyRecords.length === 0) {
        return {
          medicationId: medId,
          name: medication.name,
          genericName: medication.genericName,
          efficacyRating: null,
          recordsCount: 0,
          message: 'No efficacy data available'
        };
      }
      
      // Calculate overall efficacy rating
      const totalRating = efficacyRecords.reduce((sum, record) => sum + record.overallRating, 0);
      const averageRating = Math.round((totalRating / efficacyRecords.length) * 10) / 10;
      
      // If comparing for specific symptom, calculate symptom-specific rating
      let symptomRating = null;
      if (symptom) {
        let symptomImprovementTotal = 0;
        let symptomRecordCount = 0;
        
        efficacyRecords.forEach(record => {
          if (record.targetSymptoms && record.targetSymptoms.length > 0) {
            const matchingSymptom = record.targetSymptoms.find(s => s.name === symptom);
            if (matchingSymptom && matchingSymptom.improvementRating) {
              symptomImprovementTotal += matchingSymptom.improvementRating;
              symptomRecordCount++;
            }
          }
        });
        
        if (symptomRecordCount > 0) {
          symptomRating = Math.round((symptomImprovementTotal / symptomRecordCount) * 10) / 10;
        }
      }
      
      // Calculate side effects profile
      const sideEffectsMap = {};
      efficacyRecords.forEach(record => {
        if (record.sideEffects && record.sideEffects.length > 0) {
          record.sideEffects.forEach(effect => {
            const effectName = effect.effect;
            
            if (!sideEffectsMap[effectName]) {
              sideEffectsMap[effectName] = {
                effect: effectName,
                count: 1
              };
            } else {
              sideEffectsMap[effectName].count++;
            }
          });
        }
      });
      
      // Extract top side effects
      const topSideEffects = Object.values(sideEffectsMap)
        .sort((a, b) => b.count - a.count)
        .slice(0, 3)
        .map(effect => ({
          effect: effect.effect,
          occurrencePercentage: Math.round((effect.count / efficacyRecords.length) * 100)
        }));
      
      return {
        medicationId: medId,
        name: medication.name,
        genericName: medication.genericName,
        efficacyRating: averageRating,
        recordsCount: efficacyRecords.length,
        symptomRating,
        topSideEffects,
        latestRecord: efficacyRecords.sort((a, b) => 
          new Date(b.recordedAt) - new Date(a.recordedAt))[0].recordedAt
      };
    }));
    
    // Sort by efficacy rating (descending)
    comparison.sort((a, b) => {
      // Handle null ratings (put them at the end)
      if (a.efficacyRating === null) return 1;
      if (b.efficacyRating === null) return -1;
      return b.efficacyRating - a.efficacyRating;
    });
    
    res.status(200).json({
      status: 'success',
      symptom: symptom || 'Overall comparison',
      medications: comparison
    });
  } catch (error) {
    logger.error('Error comparing medication efficacy:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to compare medication efficacy',
      error: process.env.NODE_ENV === 'development' ? error.message : 'An unexpected error occurred'
    });
  }
};

/**
 * Get AI-generated insights about medication efficacy
 * @route GET /api/medications/:id/efficacy/insights
 */
exports.getEfficacyInsights = async (req, res) => {
  try {
    // Validate medication access
    const medication = await Medication.findOne({
      _id: req.params.id,
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
    
    // Get efficacy records for this medication
    const efficacyRecords = await MedicationEfficacy.find({
      medicationId: medication._id
    }).sort({ recordedAt: -1 });
    
    if (efficacyRecords.length < 3) {
      return res.status(200).json({
        status: 'success',
        message: 'Not enough efficacy data for insights. At least 3 records are needed.',
        insights: []
      });
    }
    
    // Skip AI processing in development mode to save API calls
    if (process.env.NODE_ENV === 'development') {
      return res.status(200).json({
        status: 'success',
        insights: [
          "Based on your reports, this medication seems to work best when taken in the morning.",
          "You experience fewer side effects when taking this medication with food.",
          "Your symptom relief appears to be more effective when you maintain consistent dosing times.",
          "Consider discussing with your healthcare provider about the pattern of mild headaches you've reported as side effects."
        ]
      });
    }
    
    // Prepare data for AI analysis
    // Get health check-ins around the efficacy records to provide context
    const dateRanges = efficacyRecords.map(record => {
      const recordDate = new Date(record.recordedAt);
      const dayBefore = new Date(recordDate);
      dayBefore.setDate(dayBefore.getDate() - 1);
      
      const dayAfter = new Date(recordDate);
      dayAfter.setDate(dayAfter.getDate() + 1);
      
      return { start: dayBefore, end: dayAfter, efficacyRecord: record };
    });
    
    // Collect health check-ins within those date ranges
    const healthData = await Promise.all(dateRanges.map(async dateRange => {
      const checkIns = await HealthCheckIn.find({
        userId: req.user._id,
        createdAt: {
          $gte: dateRange.start,
          $lte: dateRange.end
        }
      });
      
      return {
        efficacyRecord: dateRange.efficacyRecord,
        checkIns
      };
    }));
    
    // Prepare medication data summary for AI
    const medicationSummary = {
      name: medication.name,
      genericName: medication.genericName,
      dosage: medication.dosage,
      frequency: {
        timesPerDay: medication.frequency.timesPerDay,
        asNeeded: medication.frequency.asNeeded || false
      },
      purpose: medication.purpose || 'Not specified',
      efficacyReports: efficacyRecords.map(record => ({
        date: record.recordedAt,
        overallRating: record.overallRating,
        symptomRelief: record.symptomRelief,
        timeToEffect: record.timeToEffect,
        effectDuration: record.effectDuration,
        sideEffects: record.sideEffects,
        targetSymptoms: record.targetSymptoms,
        notes: record.notes,
        healthContext: healthData.find(d => 
          d.efficacyRecord._id.toString() === record._id.toString()
        )?.checkIns.map(c => ({
          feeling: c.feeling,
          symptoms: c.symptoms
        })) || []
      }))
    };
    
    // Call OpenAI API for insights
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { 
          role: "system", 
          content: "You are a helpful healthcare assistant analyzing medication efficacy patterns. Provide personalized, actionable insights based on the data. Focus on patterns related to efficacy, side effects, timing, and contextual factors. Maintain a supportive tone while being specific and practical." 
        },
        { 
          role: "user", 
          content: `Analyze this medication efficacy data and provide 3-5 personalized, actionable insights:
          ${JSON.stringify(medicationSummary, null, 2)}` 
        }
      ],
      temperature: 0.5,
      max_tokens: 400
    });
    
    // Parse the response
    const aiResponse = completion.choices[0].message.content.trim();
    
    // Split response into individual insights
    const insights = aiResponse
      .split(/\d+\.|\n-|\n\*/)
      .map(insight => insight.trim())
      .filter(insight => insight.length > 0);
    
    res.status(200).json({
      status: 'success',
      insights
    });
  } catch (error) {
    logger.error('Error getting medication efficacy insights:', error);
    
    // Provide fallback insights in case of API error
    res.status(200).json({
      status: 'success',
      message: 'Generated general insights due to processing limitations',
      insights: [
        "Consider tracking the specific time of day when you take this medication to identify patterns in effectiveness.",
        "Monitoring how long the medication takes to work and how long effects last can help optimize your dosing schedule.",
        "Discuss any side effects with your healthcare provider to determine if adjustments to dosage or timing might help.",
        "Your consistent tracking provides valuable information about this medication's effectiveness for your specific symptoms."
      ]
    });
  }
};

/**
 * Get side effects data for a medication with severity trends
 * @route GET /api/medications/:id/efficacy/side-effects
 */
exports.getSideEffects = async (req, res) => {
  try {
    // Validate medication access
    const medication = await Medication.findOne({
      _id: req.params.id,
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
    
    // Get all side effect records for this medication
    const sideEffects = await SideEffect.find({
      medicationId: medication._id
    }).sort({ onset: -1 });
    
    // Get efficacy records to analyze side effect reports over time
    const efficacyRecords = await MedicationEfficacy.find({
      medicationId: medication._id
    }).sort({ recordedAt: 1 }); // Sort chronologically
    
    // If no side effects reported, return early
    if (sideEffects.length === 0 && 
        (!efficacyRecords.length || !efficacyRecords.some(r => r.sideEffects && r.sideEffects.length > 0))) {
      return res.status(200).json({
        status: 'success',
        message: 'No side effects reported for this medication',
        sideEffects: [],
        trends: []
      });
    }
    
    // Analyze side effect trends over time from efficacy records
    const effectTrends = {};
    
    efficacyRecords.forEach(record => {
      if (record.sideEffects && record.sideEffects.length > 0) {
        record.sideEffects.forEach(effect => {
          const effectName = effect.effect;
          
          if (!effectTrends[effectName]) {
            effectTrends[effectName] = {
              effect: effectName,
              dataPoints: []
            };
          }
          
          effectTrends[effectName].dataPoints.push({
            date: record.recordedAt,
            severity: effect.severity || 0
          });
        });
      }
    });
    
    // Calculate trend direction for each side effect
    Object.values(effectTrends).forEach(trend => {
      if (trend.dataPoints.length < 2) {
        trend.direction = 'stable';
        trend.change = 0;
      } else {
        // Sort data points chronologically
        trend.dataPoints.sort((a, b) => new Date(a.date) - new Date(b.date));
        
        // Compare first half with second half if we have enough data points
        if (trend.dataPoints.length >= 4) {
          const midpoint = Math.floor(trend.dataPoints.length / 2);
          const firstHalf = trend.dataPoints.slice(0, midpoint);
          const secondHalf = trend.dataPoints.slice(midpoint);
          
          const firstHalfAvg = firstHalf.reduce((sum, point) => sum + point.severity, 0) / firstHalf.length;
          const secondHalfAvg = secondHalf.reduce((sum, point) => sum + point.severity, 0) / secondHalf.length;
          
          const difference = secondHalfAvg - firstHalfAvg;
          
          trend.change = Math.round(difference * 10) / 10;
          
          if (difference <= -0.5) {
            trend.direction = 'improving'; // Severity decreasing
          } else if (difference >= 0.5) {
            trend.direction = 'worsening'; // Severity increasing
          } else {
            trend.direction = 'stable';
          }
        } else {
          // Simple comparison of first and last point
          const first = trend.dataPoints[0];
          const last = trend.dataPoints[trend.dataPoints.length - 1];
          
          trend.change = Math.round((last.severity - first.severity) * 10) / 10;
          
          if ((last.severity - first.severity) <= -0.5) {
            trend.direction = 'improving';
          } else if ((last.severity - first.severity) >= 0.5) {
            trend.direction = 'worsening';
          } else {
            trend.direction = 'stable';
          }
        }
      }
      
      // Calculate average severity
      trend.averageSeverity = Math.round(
        (trend.dataPoints.reduce((sum, point) => sum + point.severity, 0) / trend.dataPoints.length) * 10
      ) / 10;
    });
    
    // Prepare trend results sorted by most recent first
    const trends = Object.values(effectTrends)
      .sort((a, b) => {
        // Sort by most recent data point
        const aLatest = new Date(a.dataPoints[a.dataPoints.length - 1].date);
        const bLatest = new Date(b.dataPoints[b.dataPoints.length - 1].date);
        return bLatest - aLatest;
      })
      .map(trend => ({
        effect: trend.effect,
        occurrences: trend.dataPoints.length,
        averageSeverity: trend.averageSeverity,
        direction: trend.direction,
        change: trend.change,
        latestSeverity: trend.dataPoints[trend.dataPoints.length - 1].severity,
        latestReport: trend.dataPoints[trend.dataPoints.length - 1].date
      }));
    
    res.status(200).json({
      status: 'success',
      sideEffects,
      trends
    });
  } catch (error) {
    logger.error('Error getting medication side effects:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get medication side effects',
      error: process.env.NODE_ENV === 'development' ? error.message : 'An unexpected error occurred'
    });
  }
};

/**
 * Get contextual factors that may affect efficacy
 * @route GET /api/medications/:id/efficacy/context
 */
exports.getEfficacyContext = async (req, res) => {
  try {
    // Validate medication access
    const medication = await Medication.findOne({
      _id: req.params.id,
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
    
    // Get efficacy records
    const efficacyRecords = await MedicationEfficacy.find({
      medicationId: medication._id
    }).sort({ recordedAt: -1 });
    
    // If no reports, return early
    if (efficacyRecords.length === 0) {
      return res.status(200).json({
        status: 'success',
        message: 'No efficacy data available for context analysis',
        contextualFactors: []
      });
    }
    
    // Get health check-ins that occurred near efficacy reports
    const contextData = await Promise.all(efficacyRecords.map(async (record) => {
      // Find health check-ins within 24 hours of the efficacy report
      const recordDate = new Date(record.recordedAt);
      const dayBefore = new Date(recordDate);
      dayBefore.setDate(dayBefore.getDate() - 1);
      
      const dayAfter = new Date(recordDate);
      dayAfter.setDate(dayAfter.getDate() + 1);
      
      const checkIns = await HealthCheckIn.find({
        userId: req.user._id,
        createdAt: {
          $gte: dayBefore,
          $lte: dayAfter
        }
      });
      
      return {
        efficacyRecord: record,
        checkIns: checkIns.map(c => ({
          date: c.createdAt,
          feeling: c.feeling,
          symptoms: c.symptoms,
          sleepHours: c.sleepHours,
          stressLevel: c.stressLevel,
          exerciseMinutes: c.exerciseMinutes,
          waterIntake: c.waterIntake
        }))
      };
    }));
    
    // Analyze for patterns in high vs. low efficacy reports
    const highEfficacyRecords = efficacyRecords.filter(r => r.overallRating >= 4);
    const lowEfficacyRecords = efficacyRecords.filter(r => r.overallRating <= 2);
    
    const contextualFactors = [];
    
    // Analyze sleep patterns
    if (contextData.some(cd => cd.checkIns.some(c => c.sleepHours !== null))) {
      const highEfficacySleep = getAverageCheckInValue(highEfficacyRecords, contextData, 'sleepHours');
      const lowEfficacySleep = getAverageCheckInValue(lowEfficacyRecords, contextData, 'sleepHours');
      
      if (highEfficacySleep !== null && lowEfficacySleep !== null) {
        const difference = highEfficacySleep - lowEfficacySleep;
        
        if (Math.abs(difference) >= 1) {
          contextualFactors.push({
            factor: 'sleep',
            description: difference > 0 ? 
              `More sleep appears to improve medication effectiveness (avg ${highEfficacySleep.toFixed(1)} hours when most effective)` : 
              `Less sleep appears to improve medication effectiveness (avg ${highEfficacySleep.toFixed(1)} hours when most effective)`,
            highEfficacyValue: highEfficacySleep,
            lowEfficacyValue: lowEfficacySleep,
            difference: Math.round(difference * 10) / 10
          });
        }
      }
    }
    
    // Analyze stress patterns
    if (contextData.some(cd => cd.checkIns.some(c => c.stressLevel !== null))) {
      const highEfficacyStress = getAverageCheckInValue(highEfficacyRecords, contextData, 'stressLevel');
      const lowEfficacyStress = getAverageCheckInValue(lowEfficacyRecords, contextData, 'stressLevel');
      
      if (highEfficacyStress !== null && lowEfficacyStress !== null) {
        const difference = highEfficacyStress - lowEfficacyStress;
        
        if (Math.abs(difference) >= 0.5) {
          contextualFactors.push({
            factor: 'stress',
            description: difference < 0 ? 
              `Lower stress levels appear to improve medication effectiveness (avg ${highEfficacyStress.toFixed(1)} when most effective)` : 
              `Stress levels don't appear to negatively impact medication effectiveness`,
            highEfficacyValue: highEfficacyStress,
            lowEfficacyValue: lowEfficacyStress,
            difference: Math.round(difference * 10) / 10
          });
        }
      }
    }
    
    // Analyze exercise patterns
    if (contextData.some(cd => cd.checkIns.some(c => c.exerciseMinutes !== null))) {
      const highEfficacyExercise = getAverageCheckInValue(highEfficacyRecords, contextData, 'exerciseMinutes');
      const lowEfficacyExercise = getAverageCheckInValue(lowEfficacyRecords, contextData, 'exerciseMinutes');
      
      if (highEfficacyExercise !== null && lowEfficacyExercise !== null) {
        const difference = highEfficacyExercise - lowEfficacyExercise;
        
        if (Math.abs(difference) >= 10) {
          contextualFactors.push({
            factor: 'exercise',
            description: difference > 0 ? 
              `More exercise appears to improve medication effectiveness (avg ${highEfficacyExercise.toFixed(0)} minutes when most effective)` : 
              `Less exercise appears to improve medication effectiveness (avg ${highEfficacyExercise.toFixed(0)} minutes when most effective)`,
            highEfficacyValue: highEfficacyExercise,
            lowEfficacyValue: lowEfficacyExercise,
            difference: Math.round(difference)
          });
        }
      }
    }
    
    // Analyze time of day patterns (assuming we can extract this from recordedAt)
    const timeData = {};
    
    efficacyRecords.forEach(record => {
      const date = new Date(record.recordedAt);
      const hour = date.getHours();
      
      let timeOfDay;
      if (hour >= 5 && hour < 12) timeOfDay = 'morning';
      else if (hour >= 12 && hour < 17) timeOfDay = 'afternoon';
      else if (hour >= 17 && hour < 21) timeOfDay = 'evening';
      else timeOfDay = 'night';
      
      if (!timeData[timeOfDay]) {
        timeData[timeOfDay] = {
          count: 0,
          totalRating: 0,
          averageRating: 0
        };
      }
      
      timeData[timeOfDay].count++;
      timeData[timeOfDay].totalRating += record.overallRating;
    });
    
    // Calculate average rating by time of day
    Object.values(timeData).forEach(data => {
      data.averageRating = Math.round((data.totalRating / data.count) * 10) / 10;
    });
    
    // Find best time of day
    let bestTimeOfDay = null;
    let bestRating = 0;
    
    Object.entries(timeData).forEach(([time, data]) => {
      if (data.count >= 2 && data.averageRating > bestRating) {
        bestTimeOfDay = time;
        bestRating = data.averageRating;
      }
    });
    
    if (bestTimeOfDay) {
      contextualFactors.push({
        factor: 'timeOfDay',
        description: `Medication appears most effective when reported in the ${bestTimeOfDay} (average rating: ${bestRating})`,
        bestTimeOfDay,
        timeData
      });
    }
    
    res.status(200).json({
      status: 'success',
      contextualFactors,
      dataPoints: efficacyRecords.length
    });
  } catch (error) {
    logger.error('Error analyzing efficacy context:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to analyze efficacy context',
      error: process.env.NODE_ENV === 'development' ? error.message : 'An unexpected error occurred'
    });
  }
};

/**
 * Helper function to get average value from health check-ins related to efficacy records
 */
function getAverageCheckInValue(efficacyRecords, contextData, field) {
  let totalValue = 0;
  let count = 0;
  
  efficacyRecords.forEach(record => {
    const recordContext = contextData.find(cd => 
      cd.efficacyRecord._id.toString() === record._id.toString()
    );
    
    if (recordContext && recordContext.checkIns.length > 0) {
      recordContext.checkIns.forEach(checkIn => {
        if (checkIn[field] !== null && checkIn[field] !== undefined) {
          totalValue += checkIn[field];
          count++;
        }
      });
    }
  });
  
  return count > 0 ? totalValue / count : null;
}