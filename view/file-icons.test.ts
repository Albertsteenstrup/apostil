// Tests for the icons of files and folders as the Explorer shows them (view/file-icons.ts): a theme with font icons and language ids, shaped as
// the default theme of VS Code, and a theme of SVG pictures with compound extensions, names and folder names. Made-up themes; no VS Code.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { iconOf, iconsFor, languagesOf, parseJsonc, type IconTheme } from './file-icons';

// The languages that VS Code gives files, from contributes.languages of its extensions.
const languages = languagesOf([
  { contributes: { languages: [{ id: 'typescript', extensions: ['.ts', '.cts'] }, { id: 'markdown', extensions: ['.md'] }] } },
  { contributes: { languages: [{ id: 'jsonc', filenames: ['tsconfig.json'], extensions: ['.jsonc'] }, { id: 'dockerfile', filenames: ['Dockerfile'] }] } },
]);
const address = (file: string): string => `https://made-up.example/${file.split('/').slice(-2).join('/')}`;

test('a theme of font icons with language ids and a light part, shaped as the default theme: a file by its language, the light icon in a light theme, the fallback, and no folder icon', () => {
  const theme: IconTheme = {
    root: '/themes/made-up-font/icons',
    fonts: [{ id: 'madeup', src: [{ path: './madeup.woff', format: 'woff' }], weight: 'normal', style: 'normal', size: '150%' }],
    iconDefinitions: {
      _ts: { fontCharacter: '\\E001', fontColor: '#519aba' }, _ts_light: { fontCharacter: '\\E001', fontColor: '#498ba7' },
      _json: { fontCharacter: '\\E002', fontColor: '#cbcb41' }, _docker: { fontCharacter: '\\E003', fontColor: '#519aba' },
      _default: { fontCharacter: '\\E004', fontColor: '#d4d7d6' }, _default_light: { fontCharacter: '\\E004', fontColor: '#bfc2c1' }, _unused: { fontCharacter: '\\E005' },
    },
    file: '_default', languageIds: { typescript: '_ts', json: '_json', dockerfile: '_docker' },
    light: { file: '_default_light', languageIds: { typescript: '_ts_light' } },
  };
  assert.equal(iconOf(theme, 'src/app.ts', 'dark', languages), '_ts');
  assert.equal(iconOf(theme, 'src/app.ts', 'light', languages), '_ts_light');
  assert.equal(iconOf(theme, 'src/app.ts', 'contrast', languages), '_ts'); // no high contrast part: the base
  assert.equal(iconOf(theme, 'tsconfig.json', 'dark', languages), '_json'); // jsonc by its name, and the icon of json for it
  assert.equal(iconOf(theme, 'web/Dockerfile', 'dark', languages), '_docker');
  assert.equal(iconOf(theme, 'notes.txt', 'light', languages), '_default_light');
  assert.equal(iconOf(theme, 'src/', 'dark', languages), undefined);
  const icons = iconsFor(theme, ['src/app.ts', 'src/main.ts', 'notes.txt', 'src/'], 'dark', languages, address)!;
  assert.deepEqual(icons.paths, { 'src/app.ts': 'fi1', 'src/main.ts': 'fi1', 'notes.txt': 'fi2' });
  assert.match(icons.css, /@font-face\{font-family:"fi-madeup";src:url\("https:\/\/made-up\.example\/icons\/madeup\.woff"\) format\("woff"\)/);
  assert.match(icons.css, /\.fi\.fi1::before\{content:"\\E001";font-family:"fi-madeup";font-size:150%;color:#519aba\}/);
  assert.ok(!icons.css.includes('E005'), 'an icon that no row uses is not sent');
});

test('a theme of SVG pictures: names before extensions, the longest compound extension first, folder names, the fallbacks, and a theme in the colour of the words', () => {
  const theme: IconTheme = {
    root: '/themes/made-up-svg/icons',
    iconDefinitions: {
      _file: { iconPath: './file.svg' }, _folder: { iconPath: './folder.svg' }, _src: { iconPath: './folder-src.svg' },
      _ts: { iconPath: './ts.svg' }, _dts: { iconPath: './dts.svg' }, _package: { iconPath: './package.svg' }, _readme: { iconPath: './readme.svg' },
    },
    file: '_file', folder: '_folder', folderNames: { src: '_src' },
    fileExtensions: { ts: '_ts', 'd.ts': '_dts', json: '_file' }, fileNames: { 'package.json': '_package', 'README.md': '_readme' },
  };
  assert.equal(iconOf(theme, 'types/index.d.ts', 'dark', languages), '_dts');
  assert.equal(iconOf(theme, 'src/index.ts', 'dark', languages), '_ts');
  assert.equal(iconOf(theme, 'package.json', 'dark', languages), '_package');
  assert.equal(iconOf(theme, 'docs/readme.md', 'dark', languages), '_readme'); // names in small letters, as VS Code reads them
  assert.equal(iconOf(theme, 'notes.txt', 'dark', languages), '_file');
  assert.equal(iconOf(theme, 'web/src/', 'dark', languages), '_src');
  assert.equal(iconOf(theme, 'tests/', 'dark', languages), '_folder');
  const icons = iconsFor(theme, ['types/index.d.ts', 'tests/'], 'dark', languages, address)!;
  assert.match(icons.css, /\.fi\.fi1\{background:url\("https:\/\/made-up\.example\/icons\/dts\.svg"\) center\/contain no-repeat\}/);
  assert.match(iconsFor({ ...theme, usesCurrentColor: true }, ['tests/'], 'dark', languages, address)!.css, /background:currentColor;-webkit-mask:url\("[^"]+folder\.svg"\)/);
  const { file: _file, folder: _folder, ...none } = theme; // a theme with no icon for these rows
  assert.equal(iconsFor({ ...none, fileExtensions: {}, fileNames: {}, folderNames: {} }, ['a.txt', 'b/'], 'dark', languages, address), undefined);
  assert.deepEqual(parseJsonc('{ // a comment\n "a": "x // not a comment", /* more */ "b": [1, 2,], }'), { a: 'x // not a comment', b: [1, 2] });
});
