const mongoose = require('mongoose');

// Vital Sign Schema
const VitalSignSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true // Indexed for faster queries by user
    },
    derivedValues: {
      map: { type: Number },                // For blood pressure
      pulsePressure: { type: Number },      // For blood pressure
      percentMaxHR: { type: Number },       // For heart rate
      hrZone: { type: String },             // For heart rate
      o2Zone: { type: String },             // For oxygen level
      glucoseZone: { type: String }         // For glucose
    },
    type: {
      type: String,
      enum: ['bloodPressure', 'glucose', 'weight', 'temperature', 'heartRate', 'oxygenLevel', 'other'],
      required: true,
      index: true // Indexed for type-based queries
    },
    values: {
      systolic: { type: Number }, // for blood pressure
      diastolic: { type: Number }, // for blood pressure
      glucoseLevel: { type: Number }, // for glucose
      weight: { type: Number }, // for weight
      temperature: { type: Number }, // for temperature
      heartRate: { type: Number }, // for heart rate
      oxygenLevel: { type: Number }, // for oxygen saturation
      customValue: { type: Number } // for other
    },
    unit: { type: String },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true // Indexed for time-based queries
    },
    notes: { type: String },
    recordedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    isNormal: { 
      type: Boolean,
      index: true // Indexed for quick filtering of abnormal readings
    },
    followupRequired: {
      type: Boolean,
      default: false,
      index: true // Indexed for quick access to readings requiring followup
    },
    aiInsights: [{ type: String }], // AI-generated insights about this reading
    aiAnalysisDate: { type: Date }, // When the AI analysis was performed
    medicalDeviceId: { type: String }, // For tracking which device recorded the reading
    manualEntry: { type: Boolean, default: true }, // Whether reading was entered manually
    tags: [{ type: String }], // For additional categorization
    relatedSymptoms: [{ 
      symptom: { type: String },
      severity: { type: Number, min: 1, max: 5 }
    }], // Any symptoms related to this vital sign
    status: {
      type: String,
      enum: ['active', 'archived', 'flagged'],
      default: 'active'
    },
    isFollowUp: {
      type: Boolean,
      default: false
    },
    originalVitalSignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'VitalSign'
    },
    followUpSequence: {
      type: Number,
      default: 0
    }
  },
  {
    timestamps: true,
  }
);

// Health Check-In Schema
const HealthCheckInSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true // Indexed for faster queries by user
    },
    previousFollowUpQuestions: [{ type: String }],
    feeling: {
      type: String,
      enum: ['good', 'fair', 'poor'],
      required: true,
      index: true // Indexed for feeling-based queries
    },
    symptoms: [
      {
        name: { type: String },
        severity: { type: Number, min: 1, max: 5 },
        bodyLocation: { type: String },
        startTime: { type: Date },
        duration: { type: Number }, // Duration in hours
        characteristics: [{ type: String }], // Additional descriptors
        triggers: [{ type: String }], // What might have caused the symptom
        relievedBy: [{ type: String }] // What helps alleviate the symptom
      }
    ],
    notes: { type: String },
    aiAssessment: {
      riskLevel: { 
        type: String, 
        enum: ['low', 'medium', 'high', 'emergency'],
        index: true // Indexed for risk-based queries
      },
      recommendations: [{ type: String }],
      followUpRequired: { 
        type: Boolean, 
        default: false,
        index: true // Indexed for followup queries
      },
      reasoning: { type: String }, // AI's reasoning for the assessment
      confidenceScore: { type: Number, min: 0, max: 1 } // How confident the AI is in its assessment
    },
    recordedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    activities: [{ type: String }], // Activities done that day
    sleepHours: { type: Number }, // Hours of sleep
    stressLevel: { 
      type: Number,
      min: 1,
      max: 5
    }, // Self-reported stress level
    medicationAdherence: {
      type: String,
      enum: ['full', 'partial', 'missed'],
    }, // Whether medications were taken as prescribed
    dietQuality: { 
      type: Number,
      min: 1,
      max: 5
    }, // Self-reported diet quality
    exerciseMinutes: { type: Number }, // Minutes of exercise
    waterIntake: { type: Number }, // Glasses of water
    relatedVitalSigns: [{ 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'VitalSign'
    }], // Related vital sign readings
    status: {
      type: String,
      enum: ['active', 'archived', 'flagged'],
      default: 'active'
    },
    location: {
      type: { type: String, enum: ['Point'] },
      coordinates: { type: [Number] } // [longitude, latitude]
    },
    followUpQuestions: [{ type: String }],
    followUpResponses: [{
      question: { type: String },
      response: { type: String },
      timestamp: { type: Date, default: Date.now }
    }],
    conversationStage: {
      type: String,
      enum: ['initial', 'follow_up', 'completed'],
      default: 'initial'
    },
    isFollowUp: {
      type: Boolean,
      default: false
    },
    originalCheckInId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'HealthCheckIn'
    },
    furtherFollowUpRequired: {
      type: Boolean,
      default: false
    },
    followUpSequence: {
      type: Number,
      default: 0
    },
    weather: {
      temperature: { type: Number },
      humidity: { type: Number },
      conditions: { type: String }
    }, // Weather conditions when check-in was recorded
    deviceInfo: {
      type: { type: String }, // phone, tablet, etc.
      os: { type: String }, // iOS, Android, etc.
      model: { type: String } // device model
    } // Information about the device used for check-in
  },
  {
    timestamps: true,
  }
);

// Follow-Up Schema - used to schedule and track follow-ups
const FollowUpSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    originalCheckInId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'HealthCheckIn',
      required: true
    },
    originalVitalSignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'VitalSign'
    },
    scheduledTime: {
      type: Date,
      required: true,
      index: true  // Index for scheduled time queries
    },
    symptoms: [{
      name: { type: String },
      severity: { type: Number, min: 1, max: 5 },
      bodyLocation: { type: String },
      startTime: { type: Date }
    }],
    status: {
      type: String,
      enum: ['pending', 'completed', 'missed', 'rescheduled'],
      default: 'pending',
      index: true  // Index for status queries
    },
    riskLevel: {
      type: String,
      enum: ['low', 'medium', 'high', 'emergency'],
      required: true
    },
    completedAt: {
      type: Date
    },
    responseCheckInId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'HealthCheckIn'
    },
    responseVitalSignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'VitalSign'
    },
    notificationSent: {
      type: Boolean,
      default: false
    },
    followUpType: {
      type: String,
      enum: ['health_check', 'vital_sign', 'medication_adherence'],
      default: 'health_check'
    },
    followUpCount: {
      type: Number,
      default: 1
    },
    notes: {
      type: String
    },
    notificationData: {
      title: { type: String },
      body: { type: String },
      data: { type: mongoose.Schema.Types.Mixed }
    }
  },
  {
    timestamps: true,
  }
);

// Add geospatial index if location tracking is enabled
HealthCheckInSchema.index({ location: '2dsphere' });

// Create additional indexes for performance
FollowUpSchema.index({ userId: 1, status: 1 });
FollowUpSchema.index({ scheduledTime: 1, status: 1, notificationSent: 1 });
VitalSignSchema.index({ userId: 1, type: 1, timestamp: -1 });
HealthCheckInSchema.index({ userId: 1, createdAt: -1 });
HealthCheckInSchema.index({ originalCheckInId: 1, isFollowUp: 1 });

// Create models from schemas
const VitalSign = mongoose.model('VitalSign', VitalSignSchema);
const HealthCheckIn = mongoose.model('HealthCheckIn', HealthCheckInSchema);
const FollowUp = mongoose.model('FollowUp', FollowUpSchema);

// Export models
module.exports = { VitalSign, HealthCheckIn, FollowUp };