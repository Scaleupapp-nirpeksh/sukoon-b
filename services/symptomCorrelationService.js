// services/symptomCorrelationService.js
const mongoose = require('mongoose');
const Medication = require('../models/medicationModel');
const MedicationLog = require('../models/MedicationLog');
const { HealthCheckIn } = require('../models/healthModel');
const MedicationEfficacy = require('../models/MedicationEfficacy');
const logger = require('../utils/logger');

/**
 * Analyzes correlations between medications and symptoms
 * Identifies patterns in symptom occurrences related to medication usage
 */
class SymptomCorrelationService {
  /**
   * Analyze medication-symptom correlations for a specific user
   * @param {string} userId - User ID to analyze
   * @param {Object} options - Analysis options
   * @param {number} options.timeframeInDays - Days of history to analyze (default: 90)
   * @param {string} options.medicationId - Specific medication to analyze (optional)
   * @param {string} options.symptomName - Specific symptom to analyze (optional)
   * @returns {Promise<Object>} - Correlation analysis results
   */
  async analyzeCorrelations(userId, options = {}) {
    try {
      const { 
        timeframeInDays = 90, 
        medicationId = null,
        symptomName = null 
      } = options;
      
      // Set date range for analysis
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - timeframeInDays);
      
      // Get medication logs
      const medicationLogsQuery = {
        userId: mongoose.Types.ObjectId(userId),
        createdAt: { $gte: startDate, $lte: endDate }
      };
      
      if (medicationId) {
        medicationLogsQuery.medicationId = mongoose.Types.ObjectId(medicationId);
      }
      
      const medicationLogs = await MedicationLog.find(medicationLogsQuery)
        .populate('medicationId', 'name genericName dosage category')
        .sort({ createdAt: 1 });
        
      // Get health check-ins with symptoms
      const healthCheckInQuery = {
        userId: mongoose.Types.ObjectId(userId),
        createdAt: { $gte: startDate, $lte: endDate },
      };
      
      if (symptomName) {
        healthCheckInQuery['symptoms.name'] = { $regex: symptomName, $options: 'i' };
      }
      
      const healthCheckIns = await HealthCheckIn.find(healthCheckInQuery)
        .sort({ createdAt: 1 });
      
      // Get medication efficacy reports
      const efficacyQuery = {
        userId: mongoose.Types.ObjectId(userId),
        recordedAt: { $gte: startDate, $lte: endDate }
      };
      
      if (medicationId) {
        efficacyQuery.medicationId = mongoose.Types.ObjectId(medicationId);
      }
      
      const efficacyReports = await MedicationEfficacy.find(efficacyQuery)
        .populate('medicationId', 'name genericName')
        .sort({ recordedAt: 1 });
      
      // Organize data for analysis
      const { 
        medicationTimeline,
        symptomTimeline,
        efficacyTimeline
      } = this._buildTimelines(medicationLogs, healthCheckIns, efficacyReports);
      
      // Run correlation analyses
      const results = {
        medicationSymptomCorrelations: this._analyzeMedicationSymptomCorrelations(
          medicationTimeline, 
          symptomTimeline
        ),
        temporalPatterns: this._analyzeTemporalPatterns(
          medicationTimeline, 
          symptomTimeline
        ),
        medicationEfficacyCorrelations: this._analyzeEfficacyCorrelations(
          medicationTimeline,
          symptomTimeline, 
          efficacyTimeline
        ),
        doseResponseRelationships: this._analyzeDoseResponseRelationships(
          medicationLogs,
          healthCheckIns
        ),
        symptomNetworkAnalysis: this._analyzeSymptomNetwork(
          symptomTimeline
        ),
        dataPoints: {
          medicationLogs: medicationLogs.length,
          checkIns: healthCheckIns.length,
          efficacyReports: efficacyReports.length,
          symptoms: Object.keys(symptomTimeline).length,
          medications: Object.keys(medicationTimeline).length,
          dateRange: {
            start: startDate,
            end: endDate
          }
        }
      };
      
      return results;
    } catch (error) {
      logger.error('Error analyzing symptom correlations:', error);
      throw new Error('Failed to analyze symptom correlations');
    }
  }
  
  /**
   * Build day-by-day timelines for medications, symptoms, and efficacy
   * @private
   */
  _buildTimelines(medicationLogs, healthCheckIns, efficacyReports) {
    // Initialize timelines
    const medicationTimeline = {};  // medicationId -> dates taken
    const symptomTimeline = {};     // symptomName -> dates reported
    const efficacyTimeline = {};    // medicationId -> dates reported
    
    // Build medication timeline
    medicationLogs.forEach(log => {
      if (!log.medicationId || log.status !== 'taken') return;
      
      const medId = log.medicationId._id.toString();
      const medName = log.medicationId.name;
      const dateKey = new Date(log.createdAt).toISOString().split('T')[0];
      
      if (!medicationTimeline[medId]) {
        medicationTimeline[medId] = {
          name: medName,
          dates: {},
          firstDate: dateKey,
          lastDate: dateKey
        };
      }
      
      if (!medicationTimeline[medId].dates[dateKey]) {
        medicationTimeline[medId].dates[dateKey] = 1;
      } else {
        medicationTimeline[medId].dates[dateKey]++;
      }
      
      // Update first/last dates
      if (dateKey < medicationTimeline[medId].firstDate) {
        medicationTimeline[medId].firstDate = dateKey;
      }
      if (dateKey > medicationTimeline[medId].lastDate) {
        medicationTimeline[medId].lastDate = dateKey;
      }
    });
    
    // Build symptom timeline
    healthCheckIns.forEach(checkIn => {
      if (!checkIn.symptoms || !checkIn.symptoms.length) return;
      
      const dateKey = new Date(checkIn.createdAt).toISOString().split('T')[0];
      
      checkIn.symptoms.forEach(symptom => {
        const symptomName = symptom.name.toLowerCase();
        
        if (!symptomTimeline[symptomName]) {
          symptomTimeline[symptomName] = {
            name: symptomName,
            dates: {},
            severities: {},
            firstDate: dateKey,
            lastDate: dateKey,
            bodyLocations: new Set()
          };
        }
        
        if (!symptomTimeline[symptomName].dates[dateKey]) {
          symptomTimeline[symptomName].dates[dateKey] = 1;
          symptomTimeline[symptomName].severities[dateKey] = symptom.severity || 3;
        } else {
          symptomTimeline[symptomName].dates[dateKey]++;
          // Take the higher severity if multiple reports on same day
          symptomTimeline[symptomName].severities[dateKey] = Math.max(
            symptomTimeline[symptomName].severities[dateKey],
            symptom.severity || 3
          );
        }
        
        // Update body locations
        if (symptom.bodyLocation) {
          symptomTimeline[symptomName].bodyLocations.add(symptom.bodyLocation);
        }
        
        // Update first/last dates
        if (dateKey < symptomTimeline[symptomName].firstDate) {
          symptomTimeline[symptomName].firstDate = dateKey;
        }
        if (dateKey > symptomTimeline[symptomName].lastDate) {
          symptomTimeline[symptomName].lastDate = dateKey;
        }
      });
    });
    
    // Build efficacy timeline
    efficacyReports.forEach(report => {
      if (!report.medicationId) return;
      
      const medId = report.medicationId._id.toString();
      const dateKey = new Date(report.recordedAt).toISOString().split('T')[0];
      
      if (!efficacyTimeline[medId]) {
        efficacyTimeline[medId] = {
          name: report.medicationId.name,
          dates: {},
          ratings: {},
          targetSymptoms: new Set()
        };
      }
      
      efficacyTimeline[medId].dates[dateKey] = true;
      efficacyTimeline[medId].ratings[dateKey] = report.overallRating;
      
      // Track target symptoms
      if (report.targetSymptoms && report.targetSymptoms.length > 0) {
        report.targetSymptoms.forEach(target => {
          efficacyTimeline[medId].targetSymptoms.add(target.name.toLowerCase());
        });
      }
    });
    
    // Convert bodyLocations and targetSymptoms Sets to arrays
    Object.values(symptomTimeline).forEach(symptom => {
      symptom.bodyLocations = Array.from(symptom.bodyLocations);
    });
    
    Object.values(efficacyTimeline).forEach(efficacy => {
      efficacy.targetSymptoms = Array.from(efficacy.targetSymptoms);
    });
    
    return { medicationTimeline, symptomTimeline, efficacyTimeline };
  }
  
  /**
   * Analyze correlations between medication usage and symptom occurrence
   * @private
   */
  _analyzeMedicationSymptomCorrelations(medicationTimeline, symptomTimeline) {
    const correlations = [];
    
    // For each medication, analyze correlation with each symptom
    Object.entries(medicationTimeline).forEach(([medId, medData]) => {
      Object.entries(symptomTimeline).forEach(([symptomName, symptomData]) => {
        // Skip if no overlap in timeline
        if (medData.lastDate < symptomData.firstDate || 
            medData.firstDate > symptomData.lastDate) {
          return;
        }
        
        // Count occurrences
        let daysWithMedication = 0;
        let daysWithSymptom = 0;
        let daysWithBoth = 0;
        let daysWithNeither = 0;
        let totalDays = 0;
        
        // Get date range for this med-symptom pair
        const startDate = new Date(Math.min(
          new Date(medData.firstDate), 
          new Date(symptomData.firstDate)
        ));
        const endDate = new Date(Math.max(
          new Date(medData.lastDate), 
          new Date(symptomData.lastDate)
        ));
        
        // Count days in the range
        for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
          const dateKey = d.toISOString().split('T')[0];
          totalDays++;
          
          const hasMed = medData.dates[dateKey] ? true : false;
          const hasSymptom = symptomData.dates[dateKey] ? true : false;
          
          if (hasMed) daysWithMedication++;
          if (hasSymptom) daysWithSymptom++;
          
          if (hasMed && hasSymptom) daysWithBoth++;
          if (!hasMed && !hasSymptom) daysWithNeither++;
        }
        
        // Calculate phi coefficient (similar to correlation coefficient)
        let phi = 0;
        const denominator = Math.sqrt(
          daysWithMedication * (totalDays - daysWithMedication) * 
          daysWithSymptom * (totalDays - daysWithSymptom)
        );
        
        if (denominator > 0) {
          phi = (daysWithBoth * daysWithNeither - 
                (daysWithMedication - daysWithBoth) * (daysWithSymptom - daysWithBoth)) / 
                denominator;
        }
        
        // Calculate temporal relationship (lag)
        let lag = this._calculateTemporalLag(medData.dates, symptomData.dates);
        
        // Only include meaningful correlations
        if (Math.abs(phi) > 0.1) {
          correlations.push({
            medicationId: medId,
            medicationName: medData.name,
            symptomName: symptomData.name,
            correlation: parseFloat(phi.toFixed(2)),
            strength: this._getCorrelationStrength(phi),
            direction: phi > 0 ? 'positive' : 'negative',
            interpretation: this._interpretCorrelation(phi, lag),
            temporalRelationship: lag,
            overlap: {
              daysWithMedication,
              daysWithSymptom,
              daysWithBoth,
              totalDays,
              overlapPercentage: parseFloat(((daysWithBoth / totalDays) * 100).toFixed(1))
            }
          });
        }
      });
    });
    
    // Sort by absolute correlation strength
    return correlations.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
  }
  
  /**
   * Analyze temporal patterns between medications and symptoms
   * @private
   */
  _analyzeTemporalPatterns(medicationTimeline, symptomTimeline) {
    const patterns = [];
    
    // For each symptom, look for patterns in onset/offset relative to medications
    Object.entries(symptomTimeline).forEach(([symptomName, symptomData]) => {
      // Get all dates where this symptom occurred
      const symptomDates = Object.keys(symptomData.dates).sort();
      if (symptomDates.length < 3) return; // Not enough data
      
      // For each medication, check if it precedes symptom consistently
      Object.entries(medicationTimeline).forEach(([medId, medData]) => {
        // Skip if too little overlap
        const medDates = Object.keys(medData.dates).sort();
        if (medDates.length < 3) return;
        
        // Track temporal patterns
        let onsetPatterns = [];
        let offsetPatterns = [];
        
        // Check for symptom onset after medication
        symptomDates.forEach(symptomDate => {
          // Find the closest preceding medication date
          const precedingMedDates = medDates.filter(d => d < symptomDate);
          if (precedingMedDates.length === 0) return;
          
          const closestMedDate = precedingMedDates[precedingMedDates.length - 1];
          const daysDifference = this._daysBetween(closestMedDate, symptomDate);
          
          if (daysDifference <= 3) { // Only consider 3-day window
            onsetPatterns.push({
              medicationDate: closestMedDate,
              symptomDate: symptomDate,
              daysBetween: daysDifference
            });
          }
        });
        
        // Check for symptom offset after medication stopped
        const lastMedDate = medDates[medDates.length - 1];
        const symptomDatesAfterLastMed = symptomDates.filter(d => d > lastMedDate);
        
        if (symptomDatesAfterLastMed.length > 0) {
          const firstSymptomAfterMed = symptomDatesAfterLastMed[0];
          const daysDifference = this._daysBetween(lastMedDate, firstSymptomAfterMed);
          
          if (daysDifference <= 7) { // 7-day window
            offsetPatterns.push({
              medicationEndDate: lastMedDate,
              symptomDate: firstSymptomAfterMed,
              daysBetween: daysDifference
            });
          }
        }
        
        // Only include if we found patterns
        if (onsetPatterns.length > 0 || offsetPatterns.length > 0) {
          // Calculate average onset timing
          let avgOnsetDays = 0;
          if (onsetPatterns.length > 0) {
            avgOnsetDays = onsetPatterns.reduce((sum, p) => sum + p.daysBetween, 0) / 
                         onsetPatterns.length;
          }
          
          patterns.push({
            medicationId: medId,
            medicationName: medData.name,
            symptomName: symptomData.name,
            onsetPatterns: {
              count: onsetPatterns.length,
              averageDays: parseFloat(avgOnsetDays.toFixed(1)),
              examples: onsetPatterns.slice(0, 3) // Just show a few examples
            },
            offsetPatterns: {
              count: offsetPatterns.length,
              examples: offsetPatterns.slice(0, 3)
            },
            interpretation: this._interpretTemporalPattern(
              onsetPatterns, 
              offsetPatterns, 
              medData.name, 
              symptomData.name
            )
          });
        }
      });
    });
    
    // Sort by number of patterns (most significant first)
    return patterns.sort((a, b) => {
      return (b.onsetPatterns.count + b.offsetPatterns.count) - 
             (a.onsetPatterns.count + a.offsetPatterns.count);
    });
  }
  
  /**
   * Analyze correlations between medications, symptoms, and reported efficacy
   * @private
   */
  _analyzeEfficacyCorrelations(medicationTimeline, symptomTimeline, efficacyTimeline) {
    const efficacyInsights = [];
    
    // For each medication with efficacy data
    Object.entries(efficacyTimeline).forEach(([medId, efficacyData]) => {
      if (!medicationTimeline[medId]) return;
      
      const medName = medicationTimeline[medId].name;
      const targetSymptoms = efficacyData.targetSymptoms;
      const efficacyDates = Object.keys(efficacyData.ratings);
      
      if (efficacyDates.length < 2) return; // Not enough data
      
      // Calculate average efficacy
      const totalRating = efficacyDates.reduce((sum, date) => 
        sum + efficacyData.ratings[date], 0);
      const avgEfficacy = totalRating / efficacyDates.length;
      
      // For each target symptom, analyze effectiveness
      const symptomEffectiveness = [];
      targetSymptoms.forEach(targetSymptom => {
        if (!symptomTimeline[targetSymptom]) return;
        
        const symptomData = symptomTimeline[targetSymptom];
        
        // Count symptom occurrences before and after efficacious periods
        let beforeCount = 0;
        let afterCount = 0;
        let highEfficacyDays = 0;
        
        efficacyDates.forEach(date => {
          const efficacy = efficacyData.ratings[date];
          if (efficacy >= 4) { // High efficacy threshold
            highEfficacyDays++;
            
            // Check 3 days before
            for (let i = 1; i <= 3; i++) {
              const beforeDate = this._getDateBefore(date, i);
              if (symptomData.dates[beforeDate]) {
                beforeCount++;
              }
            }
            
            // Check 3 days after
            for (let i = 1; i <= 3; i++) {
              const afterDate = this._getDateAfter(date, i);
              if (symptomData.dates[afterDate]) {
                afterCount++;
              }
            }
          }
        });
        
        // Calculate effectiveness ratio
        let effectivenessRatio = 0;
        if (beforeCount > 0) {
          effectivenessRatio = (beforeCount - afterCount) / beforeCount;
        }
        
        symptomEffectiveness.push({
          symptomName: targetSymptom,
          symptomsBeforeEfficacy: beforeCount,
          symptomsAfterEfficacy: afterCount,
          effectivenessRatio: parseFloat(effectivenessRatio.toFixed(2)),
          effectiveness: this._interpretEffectivenessRatio(effectivenessRatio)
        });
      });
      
      // Only include if we have effectiveness data
      if (symptomEffectiveness.length > 0) {
        efficacyInsights.push({
          medicationId: medId,
          medicationName: medName,
          averageEfficacy: parseFloat(avgEfficacy.toFixed(1)),
          efficacyReportCount: efficacyDates.length,
          symptomEffectiveness: symptomEffectiveness.sort(
            (a, b) => b.effectivenessRatio - a.effectivenessRatio
          ),
          interpretation: this._interpretEfficacyInsights(
            medName, 
            avgEfficacy, 
            symptomEffectiveness
          )
        });
      }
    });
    
    return efficacyInsights.sort((a, b) => b.averageEfficacy - a.averageEfficacy);
  }
  
  /**
   * Analyze dose-response relationships
   * @private
   */
  _analyzeDoseResponseRelationships(medicationLogs, healthCheckIns) {
    // This would require more detailed dosage information than we currently have
    // Simplified implementation for now
    return [];
  }
  
  /**
   * Analyze the network of co-occurring symptoms
   * @private
   */
  _analyzeSymptomNetwork(symptomTimeline) {
    const symptomNodes = [];
    const symptomLinks = [];
    
    // Create nodes for each symptom
    Object.entries(symptomTimeline).forEach(([symptomName, data]) => {
      symptomNodes.push({
        id: symptomName,
        name: symptomName,
        frequency: Object.keys(data.dates).length,
        bodyLocations: data.bodyLocations
      });
    });
    
    // Skip if not enough symptoms
    if (symptomNodes.length < 2) {
      return { nodes: symptomNodes, links: [] };
    }
    
    // Analyze co-occurrence of symptoms
    for (let i = 0; i < symptomNodes.length; i++) {
      for (let j = i+1; j < symptomNodes.length; j++) {
        const symptom1 = symptomNodes[i].id;
        const symptom2 = symptomNodes[j].id;
        
        // Count days with co-occurrence
        let coOccurrenceDays = 0;
        const symptom1Dates = Object.keys(symptomTimeline[symptom1].dates);
        const symptom2Dates = new Set(Object.keys(symptomTimeline[symptom2].dates));
        
        symptom1Dates.forEach(date => {
          if (symptom2Dates.has(date)) {
            coOccurrenceDays++;
          }
        });
        
        // Only include if there's meaningful co-occurrence
        if (coOccurrenceDays >= 2) {
          symptomLinks.push({
            source: symptom1,
            target: symptom2,
            value: coOccurrenceDays,
          });
        }
      }
    }
    
    return {
      nodes: symptomNodes,
      links: symptomLinks
    };
  }
  
  /**
   * Calculate the temporal lag between medication use and symptom occurrence
   * @private
   */
  _calculateTemporalLag(medicationDates, symptomDates) {
    // For simplicity, we'll check if symptoms tend to occur on the same day,
    // the day after, or two days after medication
    const lagCounts = { '-1': 0, '0': 0, '1': 0, '2': 0 };
    let totalMatches = 0;
    
    // Get all dates as arrays
    const medDatesArray = Object.keys(medicationDates).sort();
    const symptomDatesArray = Object.keys(symptomDates).sort();
    
    // For each symptom date, find the closest medication date
    symptomDatesArray.forEach(symptomDate => {
      // Check for same day match
      if (medicationDates[symptomDate]) {
        lagCounts['0']++;
        totalMatches++;
        return;
      }
      
      // Check for day before
      const dayBefore = this._getDateBefore(symptomDate, 1);
      if (medicationDates[dayBefore]) {
        lagCounts['1']++;
        totalMatches++;
        return;
      }
      
      // Check for two days before
      const twoDaysBefore = this._getDateBefore(symptomDate, 2);
      if (medicationDates[twoDaysBefore]) {
        lagCounts['2']++;
        totalMatches++;
        return;
      }
      
      // Check if symptom came before medication
      const dayAfter = this._getDateAfter(symptomDate, 1);
      if (medicationDates[dayAfter]) {
        lagCounts['-1']++;
        totalMatches++;
      }
    });
    
    // Find the most common lag
    let dominantLag = null;
    let maxCount = 0;
    
    Object.entries(lagCounts).forEach(([lag, count]) => {
      if (count > maxCount) {
        maxCount = count;
        dominantLag = parseInt(lag);
      }
    });
    
    // Calculate confidence based on proportion of matches
    const confidence = totalMatches > 0 ? 
      maxCount / totalMatches : 0;
    
    return {
      dominantLag,
      confidence: parseFloat(confidence.toFixed(2)),
      distribution: lagCounts,
      totalMatches
    };
  }
  
  /** 
   * Helper function to calculate days between two date strings
   * @private
   */
  _daysBetween(dateStr1, dateStr2) {
    const date1 = new Date(dateStr1);
    const date2 = new Date(dateStr2);
    const diffTime = Math.abs(date2 - date1);
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }
  
  /**
   * Helper function to get date string for X days before
   * @private
   */
  _getDateBefore(dateStr, days) {
    const date = new Date(dateStr);
    date.setDate(date.getDate() - days);
    return date.toISOString().split('T')[0];
  }
  
  /**
   * Helper function to get date string for X days after
   * @private
   */
  _getDateAfter(dateStr, days) {
    const date = new Date(dateStr);
    date.setDate(date.getDate() + days);
    return date.toISOString().split('T')[0];
  }
  
  /**
   * Get human-readable correlation strength
   * @private
   */
  _getCorrelationStrength(correlation) {
    const absCorrelation = Math.abs(correlation);
    
    if (absCorrelation >= 0.7) return 'strong';
    if (absCorrelation >= 0.5) return 'moderate';
    if (absCorrelation >= 0.3) return 'weak';
    if (absCorrelation >= 0.1) return 'very weak';
    return 'negligible';
  }
  
  /**
   * Interpret the correlation and lag relationship
   * @private
   */
  _interpretCorrelation(correlation, lag) {
    const directionText = correlation > 0 ? 
      'positive correlation' : 'negative correlation';
    
    let lagText = '';
    if (lag.dominantLag === 0 && lag.confidence > 0.5) {
      lagText = 'typically occurring on the same day';
    } else if (lag.dominantLag > 0 && lag.confidence > 0.5) {
      lagText = `typically occurring ${lag.dominantLag} day(s) after medication`;
    } else if (lag.dominantLag < 0 && lag.confidence > 0.5) {
      lagText = 'typically occurring before medication';
    }
    
    if (correlation > 0.3) {
      return `There appears to be a ${directionText} between this medication and symptom, ${lagText}. This suggests the medication and symptom may be related.`;
    } else if (correlation < -0.3) {
      return `There appears to be a ${directionText} between this medication and symptom, ${lagText}. This may suggest the medication helps reduce this symptom.`;
    } else {
      return `There is a weak ${directionText} between this medication and symptom, ${lagText}. The relationship may not be significant.`;
    }
  }
  
  /**
   * Interpret temporal patterns
   * @private
   */
  _interpretTemporalPattern(onsetPatterns, offsetPatterns, medicationName, symptomName) {
    const interpretations = [];
    
    if (onsetPatterns.length >= 2) {
      const avgDays = onsetPatterns.reduce((sum, p) => sum + p.daysBetween, 0) / 
                    onsetPatterns.length;
      
      if (avgDays <= 1) {
        interpretations.push(`${symptomName} frequently occurs on the same day or the day after taking ${medicationName}.`);
      } else {
        interpretations.push(`${symptomName} frequently occurs about ${avgDays.toFixed(1)} days after taking ${medicationName}.`);
      }
    }
    
    if (offsetPatterns.length >= 1) {
      interpretations.push(`${symptomName} has been observed following discontinuation of ${medicationName}.`);
    }
    
    if (interpretations.length === 0) {
      return null;
    }
    
    return interpretations.join(' ');
  }
  
  /**
   * Interpret effectiveness ratio
   * @private
   */
  _interpretEffectivenessRatio(ratio) {
    if (ratio >= 0.7) return 'highly effective';
    if (ratio >= 0.5) return 'moderately effective';
    if (ratio >= 0.3) return 'somewhat effective';
    if (ratio >= 0.1) return 'slightly effective';
    if (ratio > -0.1) return 'neutral';
    return 'potentially counterproductive';
  }
  
  /**
   * Generate human-readable insights about efficacy
   * @private
   */
  _interpretEfficacyInsights(medicationName, avgEfficacy, symptomEffectiveness) {
    const insights = [];
    
    // Overall efficacy insight
    if (avgEfficacy >= 4) {
      insights.push(`${medicationName} appears to be highly effective overall with an average rating of ${avgEfficacy.toFixed(1)}/5.`);
    } else if (avgEfficacy >= 3) {
      insights.push(`${medicationName} appears to be moderately effective overall with an average rating of ${avgEfficacy.toFixed(1)}/5.`);
    } else {
      insights.push(`${medicationName} shows limited overall effectiveness with an average rating of ${avgEfficacy.toFixed(1)}/5.`);
    }
    
    // Add insights about specific symptoms
    const effectiveSymptoms = symptomEffectiveness.filter(s => s.effectivenessRatio >= 0.3);
    if (effectiveSymptoms.length > 0) {
      const topSymptom = effectiveSymptoms[0];
      insights.push(`${medicationName} appears most effective for managing ${topSymptom.symptomName}.`);
      
      if (effectiveSymptoms.length > 1) {
        const otherSymptoms = effectiveSymptoms.slice(1, 3).map(s => s.symptomName).join(' and ');
        insights.push(`It also shows effectiveness for ${otherSymptoms}.`);
      }
    }
    
    // Add insights about ineffective symptoms
    const ineffectiveSymptoms = symptomEffectiveness.filter(s => s.effectivenessRatio < 0);
    if (ineffectiveSymptoms.length > 0) {
      const worstSymptom = ineffectiveSymptoms[ineffectiveSymptoms.length - 1];
      insights.push(`${medicationName} appears less effective for managing ${worstSymptom.symptomName}.`);
    }
    
    return insights.join(' ');
  }
}


module.exports = SymptomCorrelationService;

