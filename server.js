'use strict';

const express = require('express');
const formidable = require('formidable'); // v3+ style
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const { v4: uuidv4 } = require('uuid');
const compression = require('compression');
const pino = require('pino');

// ---------- CONFIG ----------
const PORT = 16000;
const HOST = '0.0.0.0';
const DOCUMENTS_DIR = path.join(os.homedir(), 'Documents'); // Cross-platform Documents folder
const SUBMISSIONS_DIR = path.join(DOCUMENTS_DIR, 'Kidpreneur','Submissions');
const PUBLIC_DIR = path.join(__dirname, 'public'); // Your website folder

fs.ensureDirSync(SUBMISSIONS_DIR);

const logger = pino({
  transport: { target: 'pino-pretty' },
  level: 'info'
});

const app = express();
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve frontend
app.use(express.static(PUBLIC_DIR));

// ---------- HELPERS ----------
const sanitizeFilename = (name) => {
  if (!name) return 'file';
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
};

async function storeSubmission(fields, files) {
  const submissionId = uuidv4();
  const dir = path.join(SUBMISSIONS_DIR, submissionId);
  const attachmentsDir = path.join(dir, 'Attachments');
  await fs.ensureDir(attachmentsDir);

  // Map field keys to user-friendly labels
  const fieldMap = {
    fullName: 'Name',
    contact: 'Contact',
    city: 'City',
    country: 'Country',
    grade: 'Grade',
    field: 'Field',
    ideaTitle: 'Title',
    ideaDesc: 'Description'
  };

  // Write metadata.txt
  const metadataTxt = Object.entries(fields)
    .map(([k, v]) => `${fieldMap[k] || k}: ${v}`)
    .join('\n');

  await fs.writeFile(path.join(dir, 'metadata.txt'), metadataTxt, 'utf8');

  // Store uploaded files in Attachments
  if (files && files.length > 0) {
    for (const file of files) {
      const safeName = sanitizeFilename(file.originalFilename || `file-${Date.now()}`);
      const dest = path.join(attachmentsDir, safeName);
      await fs.move(file.filepath || file.path, dest, { overwrite: true });
    }
  }

  return submissionId;
}

// ---------- ROUTES ----------

// GET: fetch all ideas
app.get('/api/ideas', async (req, res) => {
  try {
    const submissions = await fs.readdir(SUBMISSIONS_DIR);
    const ideas = [];

    for (const sub of submissions) {
      const metadataPath = path.join(SUBMISSIONS_DIR, sub, 'metadata.txt');
      if (await fs.pathExists(metadataPath)) {
        const content = await fs.readFile(metadataPath, 'utf8');
        const idea = {};
        content.split('\n').forEach(line => {
          const [key, ...rest] = line.split(':');
          idea[key.trim()] = rest.join(':').trim();
        });
        ideas.push(idea);
      }
    }

    res.json(ideas);
  } catch (err) {
    logger.error(err, 'Failed to fetch ideas');
    res.status(500).json({ error: 'Failed to fetch ideas' });
  }
});

// POST: submit idea
app.post('/submit', async (req, res) => {
  logger.info('[Server] Incoming submission...');
  try {
    const form = new formidable.IncomingForm();
    form.multiples = true;
    form.keepExtensions = true;
    form.uploadDir = os.tmpdir();
    form.maxFileSize = 50 * 1024 * 1024 * 1024; // 50GB

    form.parse(req, async (err, fields, filesObj) => {
      if (err) {
        logger.error(err, 'Form parse error');
        return res.status(500).json({ error: 'Form parse failed', detail: err.message });
      }

      // Convert filesObj to array
      let files = [];
      for (const key in filesObj) {
        if (Array.isArray(filesObj[key])) {
          files.push(...filesObj[key]);
        } else {
          files.push(filesObj[key]);
        }
      }

      const id = await storeSubmission(fields, files);
      logger.info(`Submission stored with ID: ${id}`);
      return res.json({ ok: true, id });
    });
  } catch (err) {
    logger.error(err, 'Unexpected server error');
    res.status(500).json({ error: 'Unexpected server error', detail: err.message });
  }
});

// Health check
app.get('/health', (req,res)=>res.json({status:'ok'}));

app.listen(PORT, HOST, () => {
  logger.info(`✅ Kidpreneur server running at http://${HOST}:${PORT}`);
  logger.info(`📂 Submissions folder: ${SUBMISSIONS_DIR}`);
  logger.info(`🌐 Serving frontend from: ${PUBLIC_DIR}`);
});
