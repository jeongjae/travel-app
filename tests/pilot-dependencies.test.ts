import { expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { BlobReader, BlobWriter, TextReader, TextWriter, ZipReader, ZipWriter } from '@zip.js/zip.js';

it('고정 Markdown/GFM 버전이 현재 React에서 표를 표시하고 HTML/실행 URL을 실행하지 않는다', () => {
  const html = renderToStaticMarkup(
    createElement(Markdown, {
      remarkPlugins: [remarkGfm],
      skipHtml: true,
      children: '|항목|값|\n|---|---|\n|표본|가상|\n\n<script>alert(1)</script>\n\n[링크](javascript:alert%281%29)',
    }),
  );
  expect(html).toContain('<table>');
  expect(html).toContain('가상');
  expect(html).not.toContain('<script>');
  expect(html).not.toContain('javascript:');
});
it('고정 ZIP 버전이 현재 Node에서 UTF-8 자료를 왕복한다 (복원 검사는 아님)', async () => {
  const writer = new ZipWriter(new BlobWriter('application/zip'), { useWebWorkers: false });
  await writer.add('manifest.json', new TextReader('{"가상":true}'));
  const blob = await writer.close();
  const reader = new ZipReader(new BlobReader(blob), { useWebWorkers: false });
  try {
    const entries = await reader.getEntries();
    expect(entries.map((e) => e.filename)).toEqual(['manifest.json']);
    const entry = entries[0];
    if (entry.directory) throw new Error('파일 entry가 필요합니다.');
    expect(await entry.getData(new TextWriter())).toBe('{"가상":true}');
  } finally {
    await reader.close();
  }
});
