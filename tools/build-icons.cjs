// 图像依赖仅在构建时使用，Windows / macOS 共用矢量源。
const sharp = require('sharp');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

async function main() {
  const assets = path.join(__dirname, '../desktop/assets');
  const svg = await fs.readFile(path.join(assets, 'icon.svg'));
  const png = (size) => sharp(svg).resize(size, size).png().toBuffer();
  const master = await png(1024);
  const stats = await sharp(master).stats();
  assert.equal(stats.isOpaque, false, '图标保留透明边缘');
  assert.ok(stats.channels.some((channel) => channel.stdev > 10), '图标不能是空白画布');
  await fs.writeFile(path.join(assets, 'icon.png'), master);

  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const images = await Promise.all(sizes.map(png));
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  images.forEach((bytes, i) => {
    const at = 6 + i * 16;
    header[at] = header[at + 1] = sizes[i] === 256 ? 0 : sizes[i];
    header.writeUInt16LE(1, at + 4);
    header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(bytes.length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += bytes.length;
  });
  await fs.writeFile(path.join(assets, 'icon.ico'), Buffer.concat([header, ...images]));

  const chunks = await Promise.all([[16, 'icp4'], [32, 'icp5'], [64, 'icp6'], [128, 'ic07'], [256, 'ic08'], [512, 'ic09'], [1024, 'ic10']].map(async ([size, type]) => {
    const bytes = await png(size), chunk = Buffer.alloc(8);
    chunk.write(type); chunk.writeUInt32BE(bytes.length + 8, 4);
    return Buffer.concat([chunk, bytes]);
  }));
  const icnsHeader = Buffer.alloc(8);
  icnsHeader.write('icns'); icnsHeader.writeUInt32BE(chunks.reduce((sum, item) => sum + item.length, 8), 4);
  await fs.writeFile(path.join(assets, 'icon.icns'), Buffer.concat([icnsHeader, ...chunks]));
  console.log('已从 icon.svg 自动生成 icon.png / icon.ico / icon.icns');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
