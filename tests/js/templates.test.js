import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultTemplates, instantiateTemplate, listTemplates } from '../../public/js/core/templates.js';
import { blockReferences } from '../../public/js/core/references.js';
import { shape } from './helpers.js';

test('default templates: Book, Article, Blog Article and Person with metadata', () => {
  const templatesPage = { title: 'Templates', blocks: defaultTemplates() };
  const templates = listTemplates(templatesPage);
  assert.deepEqual(templates.map((t) => t.name), ['Book', 'Article', 'Blog Article', 'Person']);
  const person = templates.find((t) => t.name === 'Person');
  assert.equal(person.blocks[0].text, 'Metadata::');
  assert.equal(person.blocks[0].children.length, 9);
  assert.deepEqual(blockReferences(person.blocks[0].children.at(-1).text), ['Tags', 'People']);
});

test('instantiating copies blocks with new ids', () => {
  const [book] = listTemplates({ blocks: defaultTemplates() });
  const copy = instantiateTemplate(book);
  assert.deepEqual(shape(copy), shape(book.blocks));
  assert.notEqual(copy[0].id, book.blocks[0].id);
});
