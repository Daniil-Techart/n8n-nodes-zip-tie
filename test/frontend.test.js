'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const packageJson = require('../package.json');
const frontend = fs.readFileSync(
	path.join(__dirname, '..', 'frontend', 'zip-ties-frontend.js'),
	'utf8',
);

test('frontend version matches the package version', () => {
	const match = /const version = '([^']+)'/.exec(frontend);
	assert.ok(match, 'frontend version constant is missing');
	assert.equal(match[1], packageJson.version);
});

test('frontend installs the workflow save guard during start', () => {
	assert.match(frontend, /function start\(\) \{\s*installSaveGuard\(\);/);
});

test('frontend detaches pasted tie nodes from an existing group', () => {
	assert.match(frontend, /function normalizeTieGroups\(store, event\)/);
	assert.match(frontend, /normalizeTieGroups\(store, event\);/);
});

test('frontend opens compact tie settings on double click', () => {
	assert.match(frontend, /function openTieNode\(/);
	assert.match(frontend, /addEventListener\(\s*'dblclick'/);
});

test('frontend implements a custom group clipboard', () => {
	assert.match(frontend, /function copyTieGroups\(/);
	assert.match(frontend, /function pasteTieClipboard\(/);
	assert.match(frontend, /if \(copyTieGroups\(store\)\)/);
	assert.match(frontend, /if \(pasteTieClipboard\(store\)\)/);
});
