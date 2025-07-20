const { Storage } = require('@google-cloud/storage');

let storage = null;
let bucket = null;

const initializeGCP = () => {
  try {
    // Initialize Google Cloud Storage
    storage = new Storage({
      projectId: process.env.GCP_PROJECT_ID,
      keyFilename: process.env.GCP_KEY_FILE, // Path to service account key file
    });

    // Get bucket reference
    bucket = storage.bucket(process.env.GCP_BUCKET_NAME);

    console.log('Google Cloud Storage initialized');
    return true;
  } catch (error) {
    console.error('GCP initialization failed:', error);
    return false;
  }
};

const uploadVideoToGCP = async (fileBuffer, fileName, metadata = {}) => {
  try {
    if (!bucket) {
      throw new Error('GCP bucket not initialized');
    }

    const file = bucket.file(fileName);
    
    const stream = file.createWriteStream({
      metadata: {
        contentType: metadata.contentType || 'video/mp4',
        metadata: {
          ...metadata,
          uploadedAt: new Date().toISOString()
        }
      },
      resumable: true,
      validation: 'md5'
    });

    return new Promise((resolve, reject) => {
      stream.on('error', (error) => {
        console.error('GCP upload error:', error);
        reject(error);
      });

      stream.on('finish', async () => {
        try {
          // Make file publicly readable
          await file.makePublic();
          
          const publicUrl = `https://storage.googleapis.com/${process.env.GCP_BUCKET_NAME}/${fileName}`;
          
          console.log(`Video uploaded: ${fileName}`);
          resolve({
            fileName,
            publicUrl,
            size: fileBuffer.length,
            uploadedAt: new Date()
          });
        } catch (error) {
          reject(error);
        }
      });

      stream.end(fileBuffer);
    });
  } catch (error) {
    console.error('GCP upload failed:', error);
    throw error;
  }
};

const deleteVideoFromGCP = async (fileName) => {
  try {
    if (!bucket) {
      throw new Error('GCP bucket not initialized');
    }

    await bucket.file(fileName).delete();
    console.log(`Video deleted: ${fileName}`);
    return true;
  } catch (error) {
    console.error('GCP delete failed:', error);
    return false;
  }
};

const getVideoStreamUrl = (fileName) => {
  try {
    if (!bucket) {
      throw new Error('GCP bucket not initialized');
    }

    // For public files, return direct URL
    return `https://storage.googleapis.com/${process.env.GCP_BUCKET_NAME}/${fileName}`;
  } catch (error) {
    console.error('Failed to get stream URL:', error);
    return null;
  }
};

const generateSignedUrl = async (fileName, expiresIn = 3600) => {
  try {
    if (!bucket) {
      throw new Error('GCP bucket not initialized');
    }

    const file = bucket.file(fileName);
    
    const [signedUrl] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + expiresIn * 1000, // Convert to milliseconds
    });

    return signedUrl;
  } catch (error) {
    console.error('Failed to generate signed URL:', error);
    return null;
  }
};

const getVideoMetadata = async (fileName) => {
  try {
    if (!bucket) {
      throw new Error('GCP bucket not initialized');
    }

    const file = bucket.file(fileName);
    const [metadata] = await file.getMetadata();
    
    return {
      name: metadata.name,
      size: metadata.size,
      contentType: metadata.contentType,
      timeCreated: metadata.timeCreated,
      updated: metadata.updated,
      md5Hash: metadata.md5Hash
    };
  } catch (error) {
    console.error('Failed to get metadata:', error);
    return null;
  }
};

module.exports = {
  initializeGCP,
  uploadVideoToGCP,
  deleteVideoFromGCP,
  getVideoStreamUrl,
  generateSignedUrl,
  getVideoMetadata,
  storage,
  bucket
};