import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

// Import models
import '../routes/create/models/Folder.js';
import '../routes/create/models/Question.js';

async function updateAllFolderStats() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/tlef-create');
    console.log('✅ Connected to MongoDB');
    
    const Folder = mongoose.model('Folder');
    const Question = mongoose.model('Question');
    
    const folders = await Folder.find({});
    console.log(`📁 Found ${folders.length} folders`);
    
    for (const folder of folders) {
      console.log(`\n📊 Updating stats for folder: ${folder.name}`);
      
      // Manual calculation for verification
      const actualQuestions = await Question.countDocuments({
        quiz: { $in: folder.quizzes }
      });
      
      console.log(`  Current stats.totalQuestions: ${folder.stats?.totalQuestions || 0}`);
      console.log(`  Actual questions in database: ${actualQuestions}`);
      
      // Update using the model method
      await folder.updateStats();
      
      console.log(`  Updated stats.totalQuestions: ${folder.stats.totalQuestions}`);
      console.log(`  ✅ Stats updated successfully`);
    }
    
    // Show summary
    const updatedFolders = await Folder.find({});
    const totalQuestions = updatedFolders.reduce((sum, folder) => sum + (folder.stats?.totalQuestions || 0), 0);
    
    console.log(`\n📊 SUMMARY:`);
    console.log(`  Total folders: ${updatedFolders.length}`);
    console.log(`  Total questions across all folders: ${totalQuestions}`);
    
    console.log(`\n✅ All folder stats have been updated!`);
    mongoose.disconnect();
    
  } catch (error) {
    console.error('❌ Error updating folder stats:', error);
    mongoose.disconnect();
    process.exit(1);
  }
}

updateAllFolderStats();