'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { ZipTie } = require('../nodes/ZipTie/ZipTie.node.js');

function makeContext(pairs, inputs) {
	const node = new ZipTie();
	node.getNodeParameter = () => pairs;
	node.getInputData = (index) => inputs[index] ?? [];
	return node;
}

test('passes every input to the output with the same index', async () => {
	const node = makeContext(3, [
		[{ json: { stream: 'A' } }, { json: { stream: 'A2' } }],
		[{ json: { stream: 'B' } }],
		[{ json: { stream: 'C' } }],
	]);

	const result = await node.execute();

	assert.equal(result.length, 3);
	assert.deepEqual(result[0], [{ json: { stream: 'A' } }, { json: { stream: 'A2' } }]);
	assert.deepEqual(result[1], [{ json: { stream: 'B' } }]);
	assert.deepEqual(result[2], [{ json: { stream: 'C' } }]);
});

test('keeps empty and missing inputs as empty outputs', async () => {
	const node = makeContext(3, [[{ json: { stream: 'A' } }], [], undefined]);

	const result = await node.execute();

	assert.equal(result.length, 3);
	assert.equal(result[0].length, 1);
	assert.deepEqual(result[1], []);
	assert.deepEqual(result[2], []);
});

test('falls back to one pair when the pair count is invalid', async () => {
	const node = makeContext(0, [
		[{ json: { stream: 'A' } }],
		[{ json: { stream: 'B' } }],
		[{ json: { stream: 'C' } }],
		[{ json: { stream: 'D' } }],
	]);

	const result = await node.execute();

	assert.equal(result.length, 1);
	assert.deepEqual(result[0], [{ json: { stream: 'A' } }]);
});

test('declares the colour, group and wait parameters', () => {
	const properties = new ZipTie().description.properties;
	const names = properties.map((property) => property.name);

	assert.deepEqual(names, ['tieColor', 'zipTieGroup', 'zipTieGroupSize', 'waitForAll']);
	assert.equal(names.includes('pairs'), false);
	assert.equal(names.includes('portLayout'), false);
	assert.equal(properties.find((property) => property.name === 'tieColor').type, 'color');
});
