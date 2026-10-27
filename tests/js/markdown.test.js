import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  blockToPlainText, formatTag, isBareTagTitle, parseBlock, parseInline, safeUrl,
} from '../../public/js/core/markdown.js';

/** The inline nodes of a one-line block, without offsets, for readable comparisons. */
function inline(text) {
  const strip = (nodes) => nodes.map(({ start, end, titleStart, titleEnd, ...node }) => (
    node.children ? { ...node, children: strip(node.children) } : node));
  return strip(parseBlock(text).body[0].children);
}

test('page links, nested links and their offsets', () => {
  const text = 'See [[Article: [[Writing]] tips]] now';
  const [, ref] = parseBlock(text).body[0].children;
  assert.equal(ref.type, 'pageRef');
  assert.equal(ref.title, 'Article: [[Writing]] tips');
  assert.equal(text.slice(ref.start, ref.end), '[[Article: [[Writing]] tips]]');
  const nested = ref.children[1];
  assert.equal(nested.title, 'Writing');
  assert.equal(text.slice(nested.titleStart, nested.titleEnd), 'Writing');
});

test('unclosed and empty links stay text', () => {
  assert.deepEqual(inline('[[open'), [{ type: 'text', value: '[[open' }]);
  assert.deepEqual(inline('[[]] and [[ ]]'), [{ type: 'text', value: '[[]] and [[ ]]' }]);
});

test('tags: bare, bracketed, boundaries and trailing punctuation', () => {
  assert.deepEqual(inline('#Books, #[[Modern Religion]].'), [
    { type: 'tag', title: 'Books', bracketed: false },
    { type: 'text', value: ', ' },
    { type: 'tag', title: 'Modern Religion', bracketed: true },
    { type: 'text', value: '.' },
  ]);
  assert.deepEqual(inline('C#sharp #123 (#work/admin) #v1.2.'), [
    { type: 'text', value: 'C#sharp #123 (' },
    { type: 'tag', title: 'work/admin', bracketed: false },
    { type: 'text', value: ') ' },
    { type: 'tag', title: 'v1.2', bracketed: false },
    { type: 'text', value: '.' },
  ]);
  assert.deepEqual(inline('#Über-Größe!'), [
    { type: 'tag', title: 'Über-Größe', bracketed: false },
    { type: 'text', value: '!' },
  ]);
});

test('headings need a space; a hash without space is a tag', () => {
  assert.equal(parseBlock('## Title').heading, 2);
  assert.equal(parseBlock('#### Four').heading, 0);
  assert.equal(parseBlock('#tag').heading, 0);
  assert.equal(parseBlock('#tag').body[0].children[0].type, 'tag');
});

test('tasks, quotes and attributes at the block start', () => {
  assert.equal(parseBlock('[ ] buy milk').task, 'todo');
  assert.equal(parseBlock('[x] bought').task, 'done');
  assert.equal(parseBlock('[X]').task, 'done');
  assert.equal(parseBlock('[ ]buy').task, null);
  assert.equal(parseBlock('> wise words').quote, true);
  const tree = parseBlock('Author:: [[Sam Harris]]');
  assert.deepEqual(tree.attribute, { name: 'Author', start: 0, end: 8, nameStart: 0, nameEnd: 6 });
  assert.equal(tree.bodyStart, 9);
  assert.equal(parseBlock('Metadata::').attribute.name, 'Metadata');
  assert.equal(parseBlock('[[Recommended By]]:: x').attribute.name, 'Recommended By');
  assert.equal(parseBlock('see https://x.org::').attribute, null);
  assert.equal(parseBlock('[ ] Due:: tomorrow').attribute.name, 'Due');
});

test('emphasis, highlight, strike and code', () => {
  assert.deepEqual(inline('**bold *it* x**'), [{
    type: 'strong',
    children: [{ type: 'text', value: 'bold ' }, { type: 'emphasis', children: [{ type: 'text', value: 'it' }] }, { type: 'text', value: ' x' }],
  }]);
  assert.deepEqual(inline('==^^both^^=='), [{ type: 'highlight', children: [{ type: 'highlight', children: [{ type: 'text', value: 'both' }] }] }]);
  assert.deepEqual(inline('~~gone~~'), [{ type: 'strike', children: [{ type: 'text', value: 'gone' }] }]);
  assert.deepEqual(inline('`a **b** [[c]]`'), [{ type: 'code', value: 'a **b** [[c]]' }]);
  assert.deepEqual(inline('``a ` b``'), [{ type: 'code', value: 'a ` b' }]);
});

test('underscores only at word boundaries', () => {
  assert.deepEqual(inline('snake_case_name'), [{ type: 'text', value: 'snake_case_name' }]);
  assert.deepEqual(inline('_it_ and __bold__'), [
    { type: 'emphasis', children: [{ type: 'text', value: 'it' }] },
    { type: 'text', value: ' and ' },
    { type: 'strong', children: [{ type: 'text', value: 'bold' }] },
  ]);
});

test('unmatched delimiters stay text', () => {
  assert.deepEqual(inline('2 * 3 * 4'), [{ type: 'text', value: '2 * 3 * 4' }]);
  assert.deepEqual(inline('**open'), [{ type: 'text', value: '**open' }]);
  assert.deepEqual(inline('`open'), [{ type: 'text', value: '`open' }]);
});

test('backslash escapes punctuation', () => {
  assert.deepEqual(inline('\\*not\\* \\[[x]]'), [{ type: 'text', value: '*not* [[x]]' }]);
});

test('links, aliases, images and autolinks', () => {
  assert.deepEqual(inline('[site](https://example.com)'), [
    { type: 'link', url: 'https://example.com/', children: [{ type: 'text', value: 'site' }] },
  ]);
  assert.deepEqual(inline('[the book]([[Waking Up]])'), [
    { type: 'alias', title: 'Waking Up', children: [{ type: 'text', value: 'the book' }] },
  ]);
  assert.deepEqual(inline('![a cat](https://x.org/c.png)'), [
    { type: 'link', url: 'https://x.org/c.png', children: [{ type: 'text', value: 'a cat' }] },
  ]);
  assert.deepEqual(inline('see https://en.wikipedia.org/wiki/Outliner_(software)). Ok'), [
    { type: 'text', value: 'see ' },
    { type: 'autolink', url: 'https://en.wikipedia.org/wiki/Outliner_(software)', text: 'https://en.wikipedia.org/wiki/Outliner_(software)' },
    { type: 'text', value: '). Ok' },
  ]);
});

test('XSS: dangerous URLs never become links', () => {
  for (const url of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'data:text/html,<script>',
    'vbscript:x', 'file:///etc/passwd', '//evil.example', 'java\tscript:alert(1)']) {
    assert.equal(safeUrl(url), null, url);
    const nodes = inline(`[click](${url})`);
    assert.ok(nodes.every((node) => node.type === 'text'), url);
  }
  assert.equal(safeUrl('mailto:me@example.com'), 'mailto:me@example.com');
  assert.equal(safeUrl('HTTPS://Example.com/a b'), 'https://example.com/a%20b');
});

test('XSS: raw HTML is just text', () => {
  assert.deepEqual(inline('<img src=x onerror=alert(1)> <script>alert(1)</script>'), [
    { type: 'text', value: '<img src=x onerror=alert(1)> <script>alert(1)</script>' },
  ]);
  assert.deepEqual(inline('[[<b onmouseover=x>]]').map((n) => n.type), ['pageRef']);
});

test('code fences, rules and multiple lines', () => {
  const tree = parseBlock('Intro\n```js\nlet a = "[[not a link]]";\n```\n---\nEnd');
  assert.deepEqual(tree.body.map((node) => node.type), ['line', 'codeBlock', 'rule', 'line']);
  assert.equal(tree.body[1].language, 'js');
  assert.equal(tree.body[1].value, 'let a = "[[not a link]]";');
  assert.equal(parseBlock('```\nopen').body[0].value, 'open');
});

test('every node offset points at its own source', () => {
  const text = '[ ] **Read** [[Waking Up]] #Books ==now== `x` https://a.org [l](https://b.org)';
  const visit = (nodes) => {
    for (const node of nodes) {
      assert.ok(node.start >= 0 && node.end <= text.length && node.start < node.end, JSON.stringify(node));
      if (node.type === 'pageRef') assert.equal(text.slice(node.start, node.end), `[[${node.title}]]`);
      if (node.type === 'tag') assert.equal(text.slice(node.start, node.end), `#${node.title}`);
      if (node.children) visit(node.children);
    }
  };
  visit(parseBlock(text).body[0].children);
});

test('parseInline with an offset shifts positions', () => {
  const [node] = parseInline('[[A]]', 10);
  assert.equal(node.start, 10);
  assert.equal(node.end, 15);
});

test('bare tag titles and formatTag', () => {
  assert.equal(isBareTagTitle('Books'), true);
  assert.equal(isBareTagTitle('work/admin'), true);
  assert.equal(isBareTagTitle('Modern Religion'), false);
  assert.equal(isBareTagTitle('123'), false);
  assert.equal(isBareTagTitle('end.'), false);
  assert.equal(formatTag('Books'), '#Books');
  assert.equal(formatTag('Modern Religion'), '#[[Modern Religion]]');
});

test('plain text of a block', () => {
  assert.equal(blockToPlainText('Tags:: #Books [[Waking Up]] **bold** [x](https://x.org)'), 'Tags: #Books Waking Up bold x');
});
