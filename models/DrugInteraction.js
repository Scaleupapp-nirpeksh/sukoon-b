const mongoose = require('mongoose');

const DrugInteractionSchema = new mongoose.Schema(
 {
   // Using a hash of sorted medication names as a unique identifier
   medicationHash: {
     type: String,
     required: true,
     unique: true,
     index: true
   },
   medications: [{
     type: String,
     required: true
   }],
   interactions: [{
     medications: [{ type: String }],
     severity: {
       type: String,
       enum: ['none', 'mild', 'moderate', 'severe']
     },
     description: { type: String },
     recommendations: [{ type: String }]
   }],
   overallSeverity: {
     type: String,
     enum: ['none', 'mild', 'moderate', 'severe'],
     index: true
   },
   recommendations: [{
     type: String
   }],
   createdAt: {
     type: Date,
     default: Date.now,
     expires: 7776000 // 90 days in seconds - after this, the record will be deleted
   },
   aiModel: {
     type: String
   },
   disclaimer: {
     type: String,
     default: "This information is provided for reference only and may not include the most recent research. Please consult with a healthcare professional before making any decisions regarding your medications."
   }
 },
 {
   timestamps: true,
 }
);

module.exports = mongoose.model('DrugInteraction', DrugInteractionSchema);