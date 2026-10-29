import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const baseUrl = process.env.N8N_BASE_URL ?? 'http://127.0.0.1:5681';
const workflowId = process.env.WORKFLOW_ID;
const email = process.env.E2E_EMAIL ?? 'e2e@example.com';
const password = process.env.E2E_PASSWORD;
if (!password) throw new Error('E2E_PASSWORD is required');

if (!workflowId) {
	throw new Error('WORKFLOW_ID is required');
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
await context.addInitScript(() => {
	try {
		localStorage.setItem('zipTies.debug', '1');
	} catch {}
});
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(String(error)));

const tiesSnapshot = () =>
	page.evaluate(() => {
		const store = window.__zipTies?.getWorkflowDocumentStore?.();
		const ties = (store?.allNodes ?? []).filter(
			(node) => node.type === 'n8n-nodes-zip-tie.zipTie',
		);
		const groups = {};
		for (const node of ties) {
			const group = node.parameters?.zipTieGroup ?? '(none)';
			groups[group] = (groups[group] ?? 0) + 1;
		}
		return { count: ties.length, groups, version: window.__zipTies?.version };
	});

try {
	await page.goto(`${baseUrl}/workflow/${workflowId}`, { waitUntil: 'domcontentloaded' });

	await page.waitForSelector('input[type="email"], .zt-tie-node', { timeout: 30000 });
	if (await page.locator('input[type="email"]').count()) {
		await page.locator('input[type="email"]').fill(email);
		await page.locator('input[type="password"]').fill(password);
		await page.locator('button:has-text("Sign in")').click();
		await page.waitForURL(/\/workflow\//, { timeout: 30000 });
	}

	console.log('browser page', page.url());
	try {
		await page.waitForSelector('.zt-tie-node', { state: 'visible', timeout: 30000 });
	} catch (error) {
		console.log('page text', (await page.locator('body').innerText()).slice(0, 1200));
		throw error;
	}
	await page.waitForFunction(() => Boolean(window.__zipTies?.version), null, { timeout: 30000 });

	const before = await tiesSnapshot();
	assert.equal(before.count, 3, 'expected one three-node tie group');
	assert.deepEqual(Object.values(before.groups), [3]);
	assert.match(before.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);

	await page.locator('.zt-tie-node').last().dblclick();
	await page.waitForFunction(
		() => {
			const pinia = document.querySelector('#app')?.__vue_app__?.config?.globalProperties?.$pinia;
			const urlId = (location.pathname.match(/\/workflow\/([^/?#]+)/) || [])[1];
			const ndv = pinia?._s?.get(`ndv/${urlId}@latest`);
			return Boolean(ndv?.isNDVOpen && ndv.activeNodeName);
		},
		null,
		{ timeout: 10000 },
	);
	const ndvText = await page.locator('body').innerText();
	assert.match(ndvText, /Tie Color/);
	assert.doesNotMatch(ndvText, /\bPairs\b/);
	assert.doesNotMatch(ndvText, /Port Layout/);
	await page.keyboard.press('Escape');
	await page.waitForFunction(
		() => {
			const pinia = document.querySelector('#app')?.__vue_app__?.config?.globalProperties?.$pinia;
			const urlId = (location.pathname.match(/\/workflow\/([^/?#]+)/) || [])[1];
			const ndv = pinia?._s?.get(`ndv/${urlId}@latest`);
			return !ndv?.isNDVOpen;
		},
		null,
		{ timeout: 10000 },
	);
	await page.waitForSelector('.zt-tie-node', { state: 'visible' });
	await page.locator('.zt-tie-node').last().click();
	await page.waitForFunction(
		() => document.querySelectorAll('.zt-tie-node.zt-group-selected').length === 3,
		null,
		{ timeout: 10000 },
	);

	await page.keyboard.press('Control+c');
	await page.keyboard.press('Control+v');
	await page.waitForFunction(
		() => document.querySelectorAll('.zt-tie-node').length === 6,
		null,
		{ timeout: 10000 },
	);

	const pasted = await tiesSnapshot();
	assert.equal(pasted.count, 6);
	assert.equal(Object.keys(pasted.groups).length, 2);
	assert.deepEqual(Object.values(pasted.groups).sort(), [3, 3]);

	await page.keyboard.press('Control+z');
	await page.waitForFunction(
		() => document.querySelectorAll('.zt-tie-node').length === 3,
		null,
		{ timeout: 10000 },
	);

	const undone = await tiesSnapshot();
	assert.equal(undone.count, 3);
	assert.deepEqual(Object.keys(undone.groups), Object.keys(before.groups));

	assert.equal(
		pageErrors.filter((error) => error.includes('[zip-ties-ui]')).length,
		0,
		'overlay reported a page error',
	);

	console.log('browser e2e passed', {
		version: before.version,
		groups: Object.keys(before.groups).length,
	});
} finally {
	await browser.close();
}
