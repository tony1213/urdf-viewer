/**
 * Automated screenshot capture for URDF Robot Viewer.
 * Usage: node scripts/screenshot-robots.mjs
 * Requires: puppeteer dev dep, vite preview built bundle.
 */
import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_DIR = path.resolve(__dirname, '..');
const SCREENSHOTS_DIR = path.join(REPO_DIR, 'screenshots');
const BASE_URL = 'http://localhost:4173/urdf-viewer/';
const VIEWPORT = { width: 1280, height: 800 };

const ROBOTS = [
  {
    label: 'Unitree G1',
    dir: '/tmp/robots/unitree_ros/robots/g1_description',
    urdfName: 'g1_29dof.urdf',
    output: 'unitree_g1.png',
  },
  {
    label: 'Unitree H1',
    dir: '/tmp/robots/unitree_ros/robots/h1_description',
    urdfName: 'h1.urdf',
    output: 'unitree_h1.png',
  },
  {
    label: 'Unitree Go2',
    dir: '/tmp/robots/unitree_ros/robots/go2_description',
    urdfName: 'go2_description.urdf',
    output: 'unitree_go2.png',
  },
  {
    label: 'Franka Panda',
    dir: '/tmp/robots/panda',
    urdfName: 'panda.urdf',
    output: 'franka_panda.png',
  },
  {
    label: 'KUKA KR210 R2700-2',
    dir: '/tmp/robots/kuka_kr210',
    urdfName: 'kr210l150.urdf',
    output: 'kuka_kr210.png',
  },
];

function getAllFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) {
      getAllFiles(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

function startPreview() {
  return new Promise((resolve, reject) => {
    const proc = spawn('npm', ['run', 'preview', '--', '--port', '4173'], {
      cwd: REPO_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timeout = setTimeout(() => reject(new Error('preview timeout')), 20000);
    const onData = (chunk) => {
      if (chunk.toString().includes('localhost')) {
        clearTimeout(timeout);
        resolve(proc);
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', reject);
  });
}

async function captureRobot(page, robot) {
  console.log(`\n→ ${robot.label}`);

  const allFiles = getAllFiles(robot.dir);
  const targetUrdf = allFiles.find(f => path.basename(f) === robot.urdfName);
  if (!targetUrdf) {
    console.error(`  URDF not found: ${robot.urdfName}`);
    return false;
  }
  // Only pass target URDF + non-URDF files (skip other .urdf variants in G1 folder)
  const fileList = [targetUrdf, ...allFiles.filter(f => !f.endsWith('.urdf'))];
  console.log(`  files: ${fileList.length}`);

  await page.goto(BASE_URL, { waitUntil: 'networkidle0', timeout: 15000 });

  const inputSel = 'input[type="file"]';
  await page.waitForSelector(inputSel);

  // webkitdirectory inputs reject individual files via CDP; strip the attribute first.
  // The viewer falls back to basename matching so paths still resolve.
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    el.removeAttribute('webkitdirectory');
    el.removeAttribute('directory');
  }, inputSel);

  const fileInput = await page.$(inputSel);
  await fileInput.uploadFile(...fileList);

  // uploadFile fires a change event, but dispatch again to be safe
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, inputSel);

  // Wait for loading spinner to appear (files accepted, React loading started)
  try {
    await page.waitForFunction(
      () => !!document.querySelector('[style*="spin 1s linear infinite"]'),
      { timeout: 8000, polling: 200 }
    );
    console.log('  loading started');
  } catch {
    console.log('  (spinner not detected — may have loaded instantly)');
  }

  // Wait for spinner to disappear
  await page.waitForFunction(
    () => !document.querySelector('[style*="spin 1s linear infinite"]'),
    { timeout: 90000, polling: 500 }
  );

  // Give Three.js a moment to finish the render pass
  await new Promise(r => setTimeout(r, 2000));

  const outPath = path.join(SCREENSHOTS_DIR, robot.output);
  await page.screenshot({ path: outPath, clip: { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height } });
  console.log(`  saved → screenshots/${robot.output}`);
  return true;
}

(async () => {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });

  console.log('Starting vite preview…');
  const server = await startPreview();
  console.log('Server ready on :4173');

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport(VIEWPORT);
    page.on('console', msg => { if (msg.type() === 'error') console.error('  [browser]', msg.text()); });

    let ok = 0;
    for (const robot of ROBOTS) {
      try {
        const success = await captureRobot(page, robot);
        if (success) ok++;
      } catch (err) {
        console.error(`  ERROR: ${err.message}`);
      }
    }

    console.log(`\nDone: ${ok}/${ROBOTS.length} screenshots captured.`);
  } finally {
    await browser.close();
    server.kill();
  }
})();
