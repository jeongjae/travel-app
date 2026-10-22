import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname, sep } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, all) => {
  if (value.startsWith('--')) pairs.push([value.slice(2), all[index + 1]]);
  return pairs;
}, []));
if (!args['source-dir'] || !args.name || !args['time-zone']) {
  console.error('사용법: node scripts/pack-spfr.mjs --source-dir <daily-cards 폴더> --name <여행명> --time-zone <IANA 시간대> [--zone-map <JSON>] [--output local-data/spfr-import.json]');
  process.exit(1);
}
try {
  const sourceDir = resolve(args['source-dir']);
  const output = resolve(args.output ?? 'local-data/spfr-import.json');
  if (output === sourceDir || output.startsWith(sourceDir + sep)) throw new Error('원본 폴더 밖에 출력 파일을 지정하세요.');
  new Intl.DateTimeFormat('en', { timeZone: args['time-zone'] });
  const zones = args['zone-map'] ? JSON.parse(await readFile(resolve(args['zone-map']), 'utf8')) : {};
  const files = (await readdir(sourceDir)).filter(name => /^day-\d+\.json$/.test(name)).sort();
  if (!files.length) throw new Error('day-NN.json 일일카드를 찾지 못했습니다.');
  const days = await Promise.all(files.map(async name => {
    const card = JSON.parse(await readFile(resolve(sourceDir, name), 'utf8'));
    if (card.schemaVersion !== '1.0' || !Array.isArray(card.stops)) throw new Error(`${name}: 지원하지 않는 카드 형식`);
    const timeZone = zones[card.date] ?? zones[String(card.day)] ?? args['time-zone'];
    new Intl.DateTimeFormat('en', { timeZone });
    // Keep only the supported itinerary fields; do not package hotel, ticket, or booking objects.
    return { schemaVersion: card.schemaVersion, day: card.day, date: card.date, city: card.city, title: card.title, timeZone,
      sourceRefs: card.sourceRefs ?? [], stops: card.stops.map(s => ({ id: s.id, name: s.name, start: s.start, end: s.end, summary: s.summary ?? '', place_ref: s.place_ref ?? null })),
    };
  }));
  await mkdir(dirname(output), { recursive: true });
  // Do not overwrite a previous export without an explicit new filename.
  await writeFile(output, JSON.stringify({ format: 'spfr-daily-cards', name: args.name, timeZone: args['time-zone'], days }, null, 2) + '\n', { flag: 'wx' });
  console.log(`일일카드 ${days.length}개를 ${output}에 묶었습니다. 앱 미리보기에서 검증 후 가져오세요.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1;
}
