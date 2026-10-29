(() => {
	const version = '0.4.0-beta.4';
	const scriptSrc =
		document.currentScript?.src ||
		document.querySelector('script[src*="zip-ties-frontend.js"]')?.src ||
		'';
	const cssUrl = scriptSrc
		? new URL(`zip-ties.css?v=${version}`, scriptSrc).href
		: '';
	const nodeSelector = '[data-node-type="n8n-nodes-zip-tie.zipTie"]';
	const sides = ['top', 'bottom', 'left', 'right'];
	const GROUP_STAGGER = 10;
	const storageKey = 'zipTies.enabled';

	let enabled = true;
	try {
		enabled = localStorage.getItem(storageKey) !== '0';
	} catch {}

	// Styles for the collapsed node.
	let cssLink = document.querySelector('link[data-zip-ties-css]');
	if (!cssLink && cssUrl) {
		cssLink = document.createElement('link');
		cssLink.rel = 'stylesheet';
		cssLink.href = cssUrl;
		cssLink.dataset.zipTiesCss = '1';
		document.head.appendChild(cssLink);
	}
	if (cssLink) cssLink.disabled = !enabled;

	const escapeAttribute = (value) =>
		String(value)
			.replace(/\\/g, '\\\\')
			.replace(/"/g, '\\"')
			.replace(/\n/g, '\\a ')
			.replace(/\r/g, '\\d ')
			.replace(/\f/g, '\\c ');
	const centerOf = (element) => {
		const rect = element.getBoundingClientRect();
		return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
	};

	/**
	 * Centre of the node as if it were expanded. When the Zip Tie is collapsed, its
	 * wrapper is only 30x20, but the node grows back to the body size on Ctrl.
	 * Using the body size keeps the side choice stable across the collapse/expand.
	 */
	const layoutCenterOf = (element) => centerOf(element);

	function parseEdgeId(id) {
		const match = /^\[([^/]+)\/([^\]]+)\]\[([^/]+)\/([^\]]+)\]$/.exec(id || '');
		if (!match) return null;
		return {
			source: match[1],
			sourceHandle: match[2],
			target: match[3],
			targetHandle: match[4],
		};
	}

	function expectedStyle(side, position) {
		const along = `${position}%`;
		const inset = 10;
		if (side === 'top') {
			return {
				top: `${inset}px`,
				left: along,
				right: 'auto',
				bottom: 'auto',
				transform: 'translate(-50%, -50%)',
			};
		}
		if (side === 'bottom') {
			return {
				top: `calc(100% - ${inset}px)`,
				left: along,
				right: 'auto',
				bottom: 'auto',
				transform: 'translate(-50%, -50%)',
			};
		}
		if (side === 'left') {
			return {
				top: along,
				left: `${inset}px`,
				right: 'auto',
				bottom: 'auto',
				transform: 'translate(-50%, -50%)',
			};
		}
		return {
			top: along,
			left: `calc(100% - ${inset}px)`,
			right: 'auto',
			bottom: 'auto',
			transform: 'translate(-50%, -50%)',
		};
	}

	function captureHandle(handle) {
		if (handle.dataset.ztOriginal) return;
		handle.dataset.ztOriginal = JSON.stringify({
			handlepos: handle.getAttribute('data-handlepos'),
			style: handle.getAttribute('style'),
			className: handle.className,
		});
	}

	function applyHandle(handle, side, position) {
		captureHandle(handle);
		const style = expectedStyle(side, position);
		let changed =
			handle.dataset.ztSide !== side ||
			handle.dataset.ztPosition !== String(position) ||
			handle.dataset.handlepos !== side ||
			!handle.classList.contains('zt-port-managed');

		for (const key of Object.keys(style)) {
			if (handle.style.getPropertyValue(key) !== style[key]) changed = true;
			handle.style.setProperty(key, style[key], 'important');
		}

		handle.dataset.ztSide = side;
		handle.dataset.ztPosition = String(position);
		handle.dataset.handlepos = side;
		handle.classList.add('zt-port-managed');
		handle.classList.remove(
			'vue-flow__handle-left',
			'vue-flow__handle-right',
			'vue-flow__handle-top',
			'vue-flow__handle-bottom',
		);
		handle.classList.add(`vue-flow__handle-${side}`);

		return changed;
	}

	/**
	 * One side per direction, chosen by majority vote:
	 * if most sources are above, every input moves to the top.
	 */
	function chooseSide(vectors, fallback) {
		if (!vectors.length) return fallback;

		const votes = { left: 0, right: 0, top: 0, bottom: 0 };
		let sumX = 0;
		let sumY = 0;

		for (const vector of vectors) {
			const side =
				Math.abs(vector.x) >= Math.abs(vector.y)
					? vector.x < 0
						? 'left'
						: 'right'
					: vector.y < 0
						? 'top'
						: 'bottom';
			votes[side]++;
			sumX += vector.x;
			sumY += vector.y;
		}

		let max = 0;
		for (const side of sides) max = Math.max(max, votes[side]);
		const winners = sides.filter((side) => votes[side] === max);
		if (winners.length === 1) return winners[0];

		return Math.abs(sumX) >= Math.abs(sumY)
			? sumX < 0
				? 'left'
				: 'right'
			: sumY < 0
				? 'top'
				: 'bottom';
	}

	const oppositeSide = (side) =>
		side === 'top' ? 'bottom' : side === 'bottom' ? 'top' : side === 'left' ? 'right' : 'left';

	function positionGroup(items, side) {
		const axis = side === 'top' || side === 'bottom' ? 'x' : 'y';
		items.sort(
			(a, b) =>
				(a.average?.[axis] ?? 0) - (b.average?.[axis] ?? 0) ||
				a.index - b.index,
		);
		items.forEach((item, index) => {
			item.side = side;
			item.position = ((index + 1) / (items.length + 1)) * 100;
		});
	}

	const measuring = new WeakSet();

	function forceRemeasure(wrapper) {
		if (measuring.has(wrapper)) return;
		measuring.add(wrapper);
		const width = wrapper.offsetWidth;
		wrapper.style.setProperty('width', `${width + 2}px`, 'important');
		setTimeout(() => {
			wrapper.style.removeProperty('width');
			setTimeout(() => measuring.delete(wrapper), 100);
		}, 280);
	}

	function applyPortLayout(forceMeasure = false, measure = true) {
		try {
			applyPortLayoutInner(forceMeasure, measure);
		} catch (error) {
			console.error('[zip-ties-ui] layout failed', error);
		}
	}

	function syncGroupSelection(store = getWorkflowDocumentStore(), clickedWrapper = null) {
		if (!store) return;
		const selectedGroupIds = new Set();
		if (clickedWrapper) {
			const node = store.getNodeById?.(clickedWrapper.dataset.id);
			const groupId = node?.parameters?.zipTieGroup;
			if (groupId) selectedGroupIds.add(groupId);
		} else {
			for (const selected of document.querySelectorAll('.vue-flow__node.selected')) {
				const node = store.getNodeById?.(selected.dataset.id);
				const groupId = node?.parameters?.zipTieGroup;
				if (groupId) selectedGroupIds.add(groupId);
			}
		}
		for (const wrapper of document.querySelectorAll('.zt-tie-node')) {
			const node = store.getNodeById?.(wrapper.dataset.id);
			const groupId = node?.parameters?.zipTieGroup;
			wrapper.classList.toggle(
				'zt-group-selected',
				Boolean(groupId && selectedGroupIds.has(groupId)),
			);
		}
	}

	function applyPortLayoutInner(forceMeasure = false, measure = true) {
		if (!enabled) return;
		const ties = [...document.querySelectorAll(nodeSelector)];
		if (!ties.length) return;

		const docStore = getWorkflowDocumentStore();
		let groups = new Map();
		if (docStore) {
			observeStore(docStore);
			sanitizeConnections(docStore);
			groups = collectTieGroups(docStore);
			syncGroupPositions(docStore);
		}
		const nodes = new Map(
			[...document.querySelectorAll('.vue-flow__node[data-id]')].map((element) => [
				element.dataset.id,
				element,
			]),
		);
		const edges = [...document.querySelectorAll('.vue-flow__edge[data-id]')]
			.map((element) => parseEdgeId(element.dataset.id))
			.filter(Boolean);

		const tieData = [];

		for (const tie of ties) {
			const wrapper = tie.closest('.vue-flow__node');
			if (!wrapper) continue;
			wrapper.classList.add('zt-tie-node');

			const tieId = wrapper.dataset.id;
			const nodeParameters = docStore?.getNodeById?.(tieId)?.parameters;
			const groupId = nodeParameters?.zipTieGroup || '';
			const groupNodes = groupId ? groups.get(groupId) : null;
			const groupMaster = groupNodes?.length ? groupNodes[groupNodes.length - 1] : null;
			const effectiveParameters = groupMaster?.parameters ?? nodeParameters;
			const layoutMode = effectiveParameters?.portLayout;
			const colorValue = effectiveParameters?.tieColor;
			const color =
				typeof colorValue === 'string' && colorValue.trim() && !colorValue.includes('{{')
					? colorValue
					: '#e5484d';
			tie.style.setProperty('--zt-tie-color', color);

			const tieCenter = layoutCenterOf(wrapper);
			const incoming = edges.filter((edge) => edge.target === tieId);
			const outgoing = edges.filter((edge) => edge.source === tieId);
			const handles = [...tie.querySelectorAll('.vue-flow__handle')];
			const inputItems = [];
			const outputItems = [];
			const inputVectors = [];
			const outputVectors = [];

			for (const handle of handles) {
				const isInput = handle.classList.contains('target');
				const isOutput = handle.classList.contains('source');
				if (!isInput && !isOutput) continue;

				const handleId = handle.dataset.handleid || '';
				const connected = (isInput ? incoming : outgoing).filter(
					(edge) => (isInput ? edge.targetHandle : edge.sourceHandle) === handleId,
				);

				let average = null;
				if (connected.length) {
					let sumX = 0;
					let sumY = 0;
					let count = 0;
					for (const edge of connected) {
						const other = nodes.get(isInput ? edge.source : edge.target);
						if (!other) continue;
						const point = layoutCenterOf(other);
						const vector = { x: point.x - tieCenter.x, y: point.y - tieCenter.y };
						sumX += vector.x;
						sumY += vector.y;
						count++;
					}
					if (count) {
						average = { x: sumX / count, y: sumY / count };
						(isInput ? inputVectors : outputVectors).push(average);
					}
				}

				const item = {
					handle,
					average,
					index: Number(handleId.split('/').pop()) || 0,
				};
				(isInput ? inputItems : outputItems).push(item);
			}

			tieData.push({
				wrapper,
				groupId,
				layoutMode,
				inputItems,
				outputItems,
				inputVectors,
				outputVectors,
			});
		}

		const groupVectors = new Map();
		for (const data of tieData) {
			if (!data.groupId) continue;
			const bucket = groupVectors.get(data.groupId) ?? { input: [], output: [] };
			bucket.input.push(...data.inputVectors);
			bucket.output.push(...data.outputVectors);
			groupVectors.set(data.groupId, bucket);
		}

		for (const data of tieData) {
			let inputSide;
			let outputSide;

			if (data.layoutMode === 'horizontal') {
				inputSide = 'left';
				outputSide = 'right';
			} else if (data.layoutMode === 'horizontalReverse') {
				inputSide = 'right';
				outputSide = 'left';
			} else if (data.layoutMode === 'vertical') {
				inputSide = 'top';
				outputSide = 'bottom';
			} else if (data.layoutMode === 'verticalReverse') {
				inputSide = 'bottom';
				outputSide = 'top';
			} else if (data.groupId) {
				const bucket = groupVectors.get(data.groupId);
				inputSide = chooseSide(bucket?.input ?? [], 'left');
				outputSide = oppositeSide(inputSide);
			} else {
				inputSide = chooseSide(data.inputVectors, 'left');
				outputSide = oppositeSide(inputSide);
			}

			positionGroup(data.inputItems, inputSide);
			positionGroup(data.outputItems, outputSide);

			let changed = false;
			let sideChanged = false;
			for (const item of [...data.inputItems, ...data.outputItems]) {
				const wasManaged = item.handle.classList.contains('zt-port-managed');
				const previousSide =
					item.handle.dataset.ztSide || item.handle.dataset.handlepos || '';
				changed = applyHandle(item.handle, item.side, item.position) || changed;
				if (!wasManaged || previousSide !== item.side) sideChanged = true;
			}

			if (measure && sideChanged) {
				forceRemeasure(data.wrapper);
			}
		}

		if (docStore) syncGroupSelection(docStore);
	}

	let layoutTimer = 0;
	let layoutMeasure = false;

	const scheduleLayout = (measure) => {
		layoutMeasure = layoutMeasure || measure;
		if (layoutTimer) return;
		layoutTimer = setTimeout(() => {
			layoutTimer = 0;
			const shouldMeasure = layoutMeasure;
			layoutMeasure = false;
			applyPortLayout(false, shouldMeasure);
		}, 80);
	};

	// Node movement: Vue Flow updates the wrapper transform (style attribute).
	const nodeObserver = new MutationObserver((records) => {
		for (const record of records) {
			if (record.type !== 'attributes' || record.attributeName !== 'style') continue;
			const target = record.target;
			if (!(target instanceof Element)) continue;
			if (!target.classList.contains('vue-flow__node')) continue;
			syncGroupTransform(target);
			if (target.style.minHeight || measuring.has(target)) continue;
			scheduleLayout(true);
			break;
		}
	});
	nodeObserver.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ['style'],
		subtree: true,
	});

	// A node appearing/resizing (collapse, workflow load, new node) is another trigger.
	const nodeResizeObserver = new ResizeObserver(() => scheduleLayout(true));
	const observedNodes = new WeakSet();

	function observeCanvasNodes() {
		for (const node of document.querySelectorAll('.vue-flow__node')) {
			if (observedNodes.has(node)) continue;
			observedNodes.add(node);
			nodeResizeObserver.observe(node);
		}
	}

	// Drag fallback: recalculate while any pointer button is down over a node.
	let dragging = false;
	window.addEventListener(
		'pointerdown',
		(event) => {
			if (event.button === 0) dragging = true;
		},
		true,
	);
	window.addEventListener(
		'pointerup',
		() => {
			dragging = false;
			scheduleLayout(true);
		},
		true,
	);
	window.addEventListener(
		'pointercancel',
		() => {
			dragging = false;
		},
		true,
	);
	setInterval(() => {
		if (dragging && !document.hidden) applyPortLayout(false, true);
	}, 120);

	// Safety net: Vue re-renders can reset the handles; keep the layout applied.
	setInterval(() => {
		if (enabled && !document.hidden) applyPortLayout(false, true);
	}, 500);

	// Generated rules: remove the arrowhead from edges whose target is a Zip Tie node.
	const arrowStyle = document.createElement('style');
	arrowStyle.dataset.zipTiesArrows = '1';
	document.head.appendChild(arrowStyle);

	function updateArrowRules() {
		if (!enabled) {
			arrowStyle.textContent = '';
			return;
		}
		const names = new Set();

		for (const node of document.querySelectorAll(nodeSelector)) {
			const name = node.getAttribute('data-node-name');
			if (name) names.add(name);
		}

		arrowStyle.textContent = [...names]
			.map((name) => {
				const safe = escapeAttribute(name);
				return `[data-target-node-name="${safe}"] .vue-flow__edge-path { marker-end: none !important; }`;
			})
			.join('\n');
	}

	function restoreHandle(handle) {
		let changed = false;
		const raw = handle.dataset.ztOriginal;
		const hadManaged = handle.classList.contains('zt-port-managed');

		if (raw) {
			try {
				const original = JSON.parse(raw);
				if (original.handlepos == null) handle.removeAttribute('data-handlepos');
				else handle.setAttribute('data-handlepos', original.handlepos);
				if (original.style == null) handle.removeAttribute('style');
				else handle.setAttribute('style', original.style);
				if (typeof original.className === 'string') handle.className = original.className;
				changed = true;
			} catch {}
			delete handle.dataset.ztOriginal;
			delete handle.dataset.ztSide;
			delete handle.dataset.ztPosition;
		} else if (hadManaged) {
			for (const key of ['top', 'left', 'right', 'bottom', 'transform']) {
				handle.style.removeProperty(key);
			}
			changed = true;
		}

		if (handle.classList.contains('zt-port-managed')) {
			handle.classList.remove('zt-port-managed');
			changed = true;
		}

		return changed;
	}

	function restoreAllHandles() {
		for (const tie of document.querySelectorAll(nodeSelector)) {
			const wrapper = tie.closest('.vue-flow__node');
			let changed = false;
			for (const handle of tie.querySelectorAll('.vue-flow__handle')) {
				changed = restoreHandle(handle) || changed;
			}
			if (changed && wrapper) forceRemeasure(wrapper);
		}
	}

	function setEnabled(next) {
		if (enabled === next) return;
		enabled = next;
		try {
			localStorage.setItem(storageKey, enabled ? '1' : '0');
		} catch {}
		if (cssLink) cssLink.disabled = !enabled;

		if (!enabled) {
			document.documentElement.classList.remove('zt-ctrl');
			arrowStyle.textContent = '';
			restoreAllHandles();
			console.log('[zip-ties-ui] custom styles disabled');
			return;
		}

		updateArrowRules();
		applyPortLayout(true, true);
		console.log('[zip-ties-ui] custom styles enabled');
	}

	const isTyping = (event) => {
		const target = event.target;
		return (
			target instanceof HTMLElement &&
			(target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
		);
	};

	window.addEventListener(
		'keydown',
		(event) => {
			if (!event.ctrlKey || !event.altKey || event.repeat) return;
			const isComboKey =
				event.key === 'Alt' ||
				event.key === 'Control' ||
				event.code === 'AltLeft' ||
				event.code === 'AltRight' ||
				event.code === 'ControlLeft' ||
				event.code === 'ControlRight';
			if (!isComboKey) return;
			if (isTyping(event)) return;
			event.preventDefault();
			event.stopImmediatePropagation();
			setEnabled(!enabled);
		},
		true,
	);

	// ---------- draw a tie across edges (hold X and drag) ----------

	function segmentIntersection(p, q, r, s) {
		const d1x = q.x - p.x;
		const d1y = q.y - p.y;
		const d2x = s.x - r.x;
		const d2y = s.y - r.y;
		const den = d1x * d2y - d1y * d2x;
		if (Math.abs(den) < 1e-9) return null;
		const ex = r.x - p.x;
		const ey = r.y - p.y;
		const t = (ex * d2y - ey * d2x) / den;
		const u = (ex * d1y - ey * d1x) / den;
		return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { t, u } : null;
	}

	function getWorkflowDocumentStore() {
		const app = document.querySelector('#app')?.__vue_app__;
		const pinia = app?.config?.globalProperties?.$pinia;
		if (!pinia?._s) return null;

		const urlId = (location.pathname.match(/\/workflow\/([^/?#]+)/) || [])[1];
		let fallback = null;

		for (const [id, store] of pinia._s) {
			if (!id.startsWith('workflowDocuments/')) continue;
			let workflowId = null;
			let nodes = null;
			try {
				workflowId = store.workflowId;
				nodes = store.allNodes;
			} catch {
				continue;
			}
			if (workflowId && typeof workflowId === 'object' && 'value' in workflowId) {
				workflowId = workflowId.value;
			}
			if (!Array.isArray(nodes)) continue;
			if (urlId && workflowId === urlId) return store;
			if (id === 'workflowDocuments/@latest') fallback = store;
		}

		return fallback;
	}

	function getHistoryStore() {
		const app = document.querySelector('#app')?.__vue_app__;
		const pinia = app?.config?.globalProperties?.$pinia;
		return pinia?._s?.get?.('history') ?? null;
	}

	function getNdvStore() {
		const app = document.querySelector('#app')?.__vue_app__;
		const pinia = app?.config?.globalProperties?.$pinia;
		if (!pinia?._s) return null;
		const urlId = (location.pathname.match(/\/workflow\/([^/?#]+)/) || [])[1];
		const exact = urlId ? pinia._s.get(`ndv/${urlId}@latest`) : null;
		if (exact) return exact;
		const fallback = pinia._s.get('ndv/@latest');
		if (fallback) return fallback;
		for (const [id, store] of pinia._s) {
			if (id.startsWith('ndv/') && typeof store?.setActiveNodeName === 'function') {
				return store;
			}
		}
		return null;
	}


	function tieWrapperForTarget(target, store = getWorkflowDocumentStore()) {
		if (!(target instanceof Element)) return null;
		const wrapper = target.closest('.vue-flow__node[data-id]');
		if (!wrapper) return null;
		const node = store?.getNodeById?.(wrapper.dataset.id);
		return node?.type === 'n8n-nodes-zip-tie.zipTie' ? wrapper : null;
	}

	function openTieNode(wrapper) {
		const store = getWorkflowDocumentStore();
		const node = store?.getNodeById?.(wrapper?.dataset?.id);
		const ndv = getNdvStore();
		if (!node || !ndv?.setActiveNodeName) return false;
		ndv.setActiveNodeName(node.name);
		return true;
	}

	function uniqueTieName(store) {
		const base = 'Zip Tie';
		let name = base;
		let index = 2;
		while (store.getNodeByName(name)) name = `${base} ${index++}`;
		return name;
	}

	function sanitizeConnections(store) {
		if (!store?.connectionsBySourceNode || !store?.setConnections) return 0;
		const names = new Set((store.allNodes ?? []).map((node) => node.name));
		const source = store.connectionsBySourceNode;
		const clean = {};
		let removed = 0;

		for (const [sourceName, connectionTypes] of Object.entries(source ?? {})) {
			if (!names.has(sourceName)) {
				removed++;
				continue;
			}
			const cleanTypes = {};
			for (const [type, lists] of Object.entries(connectionTypes ?? {})) {
				if (!Array.isArray(lists)) continue;
				cleanTypes[type] = lists.map((list) => {
					if (!Array.isArray(list)) return list;
					return list.filter((destination) => {
						if (!destination || typeof destination !== 'object') return false;
						if (!names.has(destination.node)) {
							removed++;
							return false;
						}
						return true;
					});
				});
			}
			clean[sourceName] = cleanTypes;
		}

		if (removed) {
			store.setConnections(clean);
			console.warn('[zip-ties-ui] removed dangling connections', removed);
		}
		return removed;
	}

	let groupMutation = 0;

	function withGroupMutation(callback) {
		groupMutation++;
		try {
			return callback();
		} finally {
			groupMutation--;
		}
	}

	function collectTieGroups(store) {
		const groups = new Map();
		for (const node of store?.allNodes ?? []) {
			if (node.type !== 'n8n-nodes-zip-tie.zipTie') continue;
			const groupId = node.parameters?.zipTieGroup;
			if (!groupId) continue;
			if (!groups.has(groupId)) groups.set(groupId, []);
			groups.get(groupId).push(node);
		}
		return groups;
	}

	function newTieGroupId() {
		return crypto.randomUUID
			? crypto.randomUUID()
			: `zip-tie-group-${Date.now()}-${Math.random().toString(16).slice(2)}`;
	}

	function newTieNodeId() {
		return crypto.randomUUID
			? crypto.randomUUID()
			: `zip-tie-${Date.now()}-${Math.random().toString(16).slice(2)}`;
	}

	function normalizeTieGroups(store, event) {
		if (groupMutation || event?.action !== 'add') return;
		const node = event.payload?.node;
		if (!node || node.type !== 'n8n-nodes-zip-tie.zipTie') return;
		const groupId = node.parameters?.zipTieGroup;
		if (!groupId) return;

		const nodes = collectTieGroups(store).get(groupId) ?? [];
		const expected = Math.max(
			0,
			...nodes.map((member) => Number(member.parameters?.zipTieGroupSize) || 0),
		);
		if (!expected || nodes.length <= expected) return;

		try {
			store.setNodeParameters?.({
				name: node.name,
				value: {
					...node.parameters,
					zipTieGroup: newTieGroupId(),
					zipTieGroupSize: 1,
				},
			});
			console.warn('[zip-ties-ui] detached pasted tie node from group', node.name);
		} catch (error) {
			console.error('[zip-ties-ui] failed to detach pasted tie node', error);
		}
	}

	let groupTransformSync = 0;

	function syncGroupPositions(store) {
		if (!store || groupMutation || dragging || groupTransformSync) return;
		for (const nodes of collectTieGroups(store).values()) {
			const master = nodes[nodes.length - 1];
			const position = master?.position;
			if (!Array.isArray(position)) continue;
			const baseY = position[1] - (nodes.length - 1) * GROUP_STAGGER;
			for (let index = 0; index < nodes.length; index++) {
				const node = nodes[index];
				const target = [position[0], baseY + index * GROUP_STAGGER];
				const current = node.position;
				if (
					!Array.isArray(current) ||
					current[0] !== target[0] ||
					current[1] !== target[1]
				) {
					store.setNodePositionById?.(node.id, target);
				}
			}
		}
	}

	function transformPosition(transform) {
		const translate = /translate(?:3d)?\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px/.exec(
			transform || '',
		);
		if (translate) return [Number(translate[1]), Number(translate[2])];
		const matrix = /matrix\(([^)]+)\)/.exec(transform || '');
		if (matrix) {
			const values = matrix[1].split(',').map(Number);
			if (values.length >= 6) return [values[4], values[5]];
		}
		return null;
	}

	function syncGroupTransform(wrapper) {
		const store = getWorkflowDocumentStore();
		const node = store?.getNodeById?.(wrapper?.dataset?.id);
		const groupId = node?.parameters?.zipTieGroup;
		if (!groupId) return;
		const transform = wrapper.style.transform;
		if (!transform) return;
		const position = transformPosition(transform);
		if (!position) return;
		const nodes = collectTieGroups(store).get(groupId) ?? [];
		const index = nodes.findIndex((member) => member.id === node.id);
		if (index < 0) return;
		const baseY = position[1] - index * GROUP_STAGGER;
		for (let otherIndex = 0; otherIndex < nodes.length; otherIndex++) {
			if (otherIndex === index) continue;
			const otherNode = nodes[otherIndex];
			const target = [position[0], baseY + otherIndex * GROUP_STAGGER];
			const other = document.querySelector(`.vue-flow__node[data-id="${otherNode.id}"]`);
			const targetTransform = `translate(${target[0]}px, ${target[1]}px)`;
			if (other && other.style.transform !== targetTransform) {
				other.style.transform = targetTransform;
			}
			const current = otherNode.position;
			if (
				!Array.isArray(current) ||
				current[0] !== target[0] ||
				current[1] !== target[1]
			) {
				groupTransformSync++;
				try {
					store.setNodePositionById?.(otherNode.id, target);
				} finally {
					groupTransformSync--;
				}
			}
		}
	}
	function maintainTieGroups(store) {
		if (!store || groupMutation) return;
		for (const nodes of collectTieGroups(store).values()) {
			const expected = Math.max(
				0,
				...nodes.map((node) => Number(node.parameters?.zipTieGroupSize) || 0),
			);
			if (!expected || nodes.length >= expected) continue;
			for (const node of [...nodes]) {
				store.removeAllNodeConnection?.(node);
				store.removeNodeById?.(node.id);
			}
		}
	}

	const observedStores = new WeakSet();

	function observeStore(store) {
		if (!store || observedStores.has(store)) return;
		observedStores.add(store);
		store.onNodesChange?.((event) => {
			normalizeTieGroups(store, event);
			syncGroupPositions(store);
			sanitizeConnections(store);
			maintainTieGroups(store);
		});
		store.onConnectionsChange?.(() => sanitizeConnections(store));
	}

	const tieUndoStack = [];
	let tieClipboard = null;

	function insertTie(crossed, store = getWorkflowDocumentStore()) {
		if (store) observeStore(store);
		if (!store) {
			console.warn('[zip-ties-ui] workflow store not found');
			return null;
		}

		const valid = [];
		for (const edge of crossed) {
			if (!Number.isFinite(edge.sourceIndex) || !Number.isFinite(edge.targetIndex)) continue;
			const source = store.getNodeById(edge.source);
			const target = store.getNodeById(edge.target);
			if (!source || !target) continue;
			const sourceConn = { node: source.name, type: 'main', index: edge.sourceIndex };
			const targetConn = { node: target.name, type: 'main', index: edge.targetIndex };
			if (!store.hasConnection({ connection: [sourceConn, targetConn] })) continue;
			valid.push({ edge, sourceConn, targetConn });
		}

		if (!valid.length) return null;

		const average = valid.reduce(
			(acc, item) => ({ x: acc.x + item.edge.flow.x, y: acc.y + item.edge.flow.y }),
			{ x: 0, y: 0 },
		);
		const center = { x: average.x / valid.length, y: average.y / valid.length };
		const offset = enabled ? [15, 10] : [55, 60];
		const position = [center.x - offset[0], center.y - offset[1]];

		const groupId = newTieGroupId();
		const history = getHistoryStore();
		const baseline = history?.undoStack?.length ?? 0;
		const record = {
			nodeId: null,
			nodeIds: [],
			name: null,
			groupId,
			baseline,
			added: [],
			originals: [],
		};

		try {
			withGroupMutation(() => {
				for (const [index, item] of valid.entries()) {
					const name = uniqueTieName(store);
					if (!record.name) record.name = name;
					const node = {
						id: newTieNodeId(),
						name,
						type: 'n8n-nodes-zip-tie.zipTie',
						typeVersion: 1,
						position: [position[0], position[1] + index * GROUP_STAGGER],
						parameters: {
							tieColor: '#e5484d',
							zipTieGroup: groupId,
							zipTieGroupSize: valid.length,
						},
						disabled: false,
					};

					const tieIn = { node: name, type: 'main', index: 0 };
					const tieOut = { node: name, type: 'main', index: 0 };
					const original = {
						sourceId: item.edge.source,
						targetId: item.edge.target,
						sourceIndex: item.edge.sourceIndex,
						targetIndex: item.edge.targetIndex,
						sourceConn: item.sourceConn,
						targetConn: item.targetConn,
						detached: false,
					};

					record.nodeIds.push(node.id);
					if (!record.nodeId) record.nodeId = node.id;
					record.originals.push(original);
					record.added.push({
						sourceConn: item.sourceConn,
						targetConn: item.targetConn,
						tieIn,
						tieOut,
						nodeId: node.id,
					});

					store.addNode(node);
					store.setNodePositionById(node.id, node.position);
					store.removeConnection({ connection: [item.sourceConn, item.targetConn] });
					original.detached = true;
					store.addConnection({ connection: [item.sourceConn, tieIn] });
					store.addConnection({ connection: [tieOut, item.targetConn] });
				}
			});
		} catch (error) {
			console.error('[zip-ties-ui] tie insertion failed, rolling back', error);
			withGroupMutation(() => {
				for (const added of [...record.added].reverse()) {
					try {
						store.removeConnection({
							connection: [added.sourceConn, added.tieIn],
						});
					} catch {}
					try {
						store.removeConnection({
							connection: [added.tieOut, added.targetConn],
						});
					} catch {}
				}
				for (const nodeId of [...record.nodeIds].reverse()) {
					const node = store.getNodeById?.(nodeId);
					if (!node) continue;
					try {
						store.removeAllNodeConnection?.(node);
					} catch {}
					try {
						store.removeNodeById?.(nodeId);
					} catch {}
				}
				for (const original of record.originals) {
					if (!original.detached) continue;
					const source = store.getNodeById?.(original.sourceId);
					const target = store.getNodeById?.(original.targetId);
					if (!source || !target) continue;
					try {
						store.addConnection({
							connection: [
								{ node: source.name, type: 'main', index: original.sourceIndex },
								{ node: target.name, type: 'main', index: original.targetIndex },
							],
						});
					} catch {}
				}
			});
			try {
				sanitizeConnections(store);
			} catch {}
			return null;
		}

		tieUndoStack.push(record);
		sanitizeConnections(store);
		return {
			name: record.name,
			count: valid.length,
			groupId,
			nodeIds: [...record.nodeIds],
		};
	}

	function selectedTieGroups(store = getWorkflowDocumentStore()) {
		if (!store) return null;
		const selected = [...document.querySelectorAll('.vue-flow__node.selected')];
		if (!selected.length) return null;
		const groups = collectTieGroups(store);
		const groupIds = new Set();
		for (const wrapper of selected) {
			const node = store.getNodeById?.(wrapper.dataset.id);
			if (!node || node.type !== 'n8n-nodes-zip-tie.zipTie') return null;
			const groupId = node.parameters?.zipTieGroup;
			if (!groupId) return null;
			groupIds.add(groupId);
		}
		const result = [];
		for (const groupId of groupIds) {
			const nodes = groups.get(groupId) ?? [];
			if (nodes.length) result.push({ groupId, nodes });
		}
		return result.length ? result : null;
	}

	function copyTieGroups(store = getWorkflowDocumentStore()) {
		if (!enabled) return false;
		const groups = selectedTieGroups(store);
		if (!groups) return false;
		try {
			tieClipboard = {
				groups: groups.map(({ nodes }) => ({
					size: nodes.length,
					nodes: nodes.map((node) => ({
						type: node.type,
						typeVersion: node.typeVersion,
						position: Array.isArray(node.position) ? [...node.position] : [0, 0],
						parameters: JSON.parse(JSON.stringify(node.parameters ?? {})),
						disabled: Boolean(node.disabled),
					})),
				})),
				pasteCount: 0,
			};
			console.log('[zip-ties-ui] copied tie groups', groups.length);
			return true;
		} catch (error) {
			console.error('[zip-ties-ui] tie copy failed', error);
			return false;
		}
	}

	function pasteTieClipboard(store = getWorkflowDocumentStore()) {
		if (!enabled || !tieClipboard?.groups?.length || !store) return false;
		const history = getHistoryStore();
		const baseline = history?.undoStack?.length ?? 0;
		const offset = 40 + (tieClipboard.pasteCount || 0) * 20;
		const record = {
			kind: 'paste',
			nodeId: null,
			nodeIds: [],
			name: null,
			groupIds: [],
			baseline,
			originals: [],
		};

		try {
			withGroupMutation(() => {
				for (const group of tieClipboard.groups) {
					const groupId = newTieGroupId();
					record.groupIds.push(groupId);
					for (const template of group.nodes) {
						const name = uniqueTieName(store);
						if (!record.name) record.name = name;
						const base = template.position ?? [0, 0];
						const parameters = { ...template.parameters };
						delete parameters.pairs;
						delete parameters.portLayout;
						delete parameters.waitForAll;
						const node = {
							id: newTieNodeId(),
							name,
							type: template.type,
							typeVersion: template.typeVersion,
							position: [base[0] + offset, base[1] + offset],
							parameters: {
								...parameters,
								zipTieGroup: groupId,
								zipTieGroupSize: group.size || group.nodes.length,
							},
							disabled: template.disabled,
						};
						record.nodeIds.push(node.id);
						if (!record.nodeId) record.nodeId = node.id;
						store.addNode(node);
						store.setNodePositionById(node.id, node.position);
					}
				}
			});
		} catch (error) {
			console.error('[zip-ties-ui] tie paste failed, rolling back', error);
			withGroupMutation(() => {
				for (const nodeId of [...record.nodeIds].reverse()) {
					const node = store.getNodeById?.(nodeId);
					if (!node) continue;
					try {
						store.removeAllNodeConnection?.(node);
					} catch {}
					try {
						store.removeNodeById?.(nodeId);
					} catch {}
				}
			});
			return false;
		}

		if (history) record.baseline = history.undoStack?.length ?? record.baseline;
		tieUndoStack.push(record);
		tieClipboard.pasteCount = (tieClipboard.pasteCount || 0) + 1;
		scheduleLayout(true);
		return { count: record.nodeIds.length, groupIds: [...record.groupIds] };
	}

	function undoLastTie() {
		const store = getWorkflowDocumentStore();
		if (!store) return false;

		const hasRecordedNode = (record) =>
			(record.nodeIds ?? (record.nodeId ? [record.nodeId] : [])).some((id) =>
				store.getNodeById(id),
			);

		while (tieUndoStack.length && !hasRecordedNode(tieUndoStack[tieUndoStack.length - 1])) {
			tieUndoStack.pop();
		}
		if (!tieUndoStack.length) return false;

		const record = tieUndoStack[tieUndoStack.length - 1];
		const history = getHistoryStore();
		const current = history?.undoStack?.length ?? 0;
		// If newer n8n actions are still on the undo stack, let n8n undo them first.
		if (current > record.baseline) return false;

		const nodeIds = record.nodeIds ?? (record.nodeId ? [record.nodeId] : []);
		const existing = nodeIds.map((id) => store.getNodeById(id)).filter(Boolean);
		if (!existing.length) {
			tieUndoStack.pop();
			return false;
		}

		withGroupMutation(() => {
			for (const node of existing) {
				store.removeAllNodeConnection(node);
				store.removeNodeById(node.id);
			}
			for (const item of record.originals ?? []) {
				const source = store.getNodeById(item.sourceId);
				const target = store.getNodeById(item.targetId);
				if (!source || !target) continue;
				store.addConnection({
					connection: [
						{ node: source.name, type: 'main', index: item.sourceIndex },
						{ node: target.name, type: 'main', index: item.targetIndex },
					],
				});
			}
		});
		sanitizeConnections(store);
		scheduleLayout(true);
		tieUndoStack.pop();
		return true;
	}

	window.addEventListener(
		'keydown',
		(event) => {
			if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
			const key = event.key?.toLowerCase();
			if (key !== 'z' && key !== 'c' && key !== 'v') return;
			if (isTyping(event)) return;

			const ndv = document.querySelector('[data-test-id="ndv"]');
			if (ndv && ndv.getBoundingClientRect().width > 0) return;
			if (document.querySelector('.el-overlay:not([style*="display: none"])')) return;

			const store = getWorkflowDocumentStore();
			if (!store) return;

			if (key === 'c') {
				if (copyTieGroups(store)) {
					event.preventDefault();
					event.stopImmediatePropagation();
				} else {
					tieClipboard = null;
				}
				return;
			}

			if (key === 'v') {
				if (pasteTieClipboard(store)) {
					event.preventDefault();
					event.stopImmediatePropagation();
				}
				return;
			}

			if (!tieUndoStack.length) return;

			let undone = false;
			try {
				undone = undoLastTie();
			} catch (error) {
				console.error('[zip-ties-ui] undo failed', error);
			}
			if (undone) {
				event.preventDefault();
				event.stopImmediatePropagation();
			}
		},
		true,
	);

	function findCrossedEdges(start, end) {
		const found = new Map();

		for (const edgeEl of document.querySelectorAll('.vue-flow__edge[data-id]')) {
			const parsed = parseEdgeId(edgeEl.dataset.id);
			if (!parsed) continue;
			if (
				!parsed.sourceHandle.startsWith('outputs/main/') ||
				!parsed.targetHandle.startsWith('inputs/main/')
			) {
				continue;
			}

			const sourceIndex = Number(parsed.sourceHandle.split('/').pop());
			const targetIndex = Number(parsed.targetHandle.split('/').pop());
			if (!Number.isFinite(sourceIndex) || !Number.isFinite(targetIndex)) continue;

			let best = null;

			for (const path of edgeEl.querySelectorAll('.vue-flow__edge-path')) {
				let length = 0;
				try {
					length = path.getTotalLength();
				} catch {
					continue;
				}
				if (!length) continue;

				const ctm = path.getScreenCTM();
				if (!ctm) continue;

				const steps = Math.max(24, Math.min(120, Math.ceil(length / 12)));
				let previous = null;

				for (let i = 0; i <= steps; i++) {
					const at = (length * i) / steps;
					const point = path.getPointAtLength(at);
					const screen = new DOMPoint(point.x, point.y).matrixTransform(ctm);
					const current = {
						flow: { x: point.x, y: point.y },
						screen: { x: screen.x, y: screen.y },
					};

					if (previous) {
						const hit = segmentIntersection(start, end, previous.screen, current.screen);
						if (hit && (!best || hit.t < best.t)) {
							best = {
								t: hit.t,
								flow: {
									x: previous.flow.x + (current.flow.x - previous.flow.x) * hit.u,
									y: previous.flow.y + (current.flow.y - previous.flow.y) * hit.u,
								},
							};
						}
					}

					previous = current;
				}
			}

			if (best) {
				found.set(edgeEl.dataset.id, {
					...parsed,
					sourceIndex,
					targetIndex,
					t: best.t,
					flow: best.flow,
				});
			}
		}

		return [...found.values()].sort((a, b) => a.t - b.t);
	}

	let strokeOverlay = null;

	function ensureStrokeOverlay() {
		if (strokeOverlay) return strokeOverlay;
		const ns = 'http://www.w3.org/2000/svg';
		const svg = document.createElementNS(ns, 'svg');
		svg.style.cssText =
			'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:99999;display:none';
		const line = document.createElementNS(ns, 'line');
		line.setAttribute('stroke', '#ff6d5a');
		line.setAttribute('stroke-width', '2.5');
		line.setAttribute('stroke-linecap', 'round');
		line.style.filter = 'drop-shadow(0 0 2px rgba(0,0,0,0.8))';
		svg.appendChild(line);
		document.body.appendChild(svg);
		strokeOverlay = { svg, line };
		return strokeOverlay;
	}

	function showStrokeLine(x1, y1, x2, y2) {
		const { svg, line } = ensureStrokeOverlay();
		line.setAttribute('x1', String(x1));
		line.setAttribute('y1', String(y1));
		line.setAttribute('x2', String(x2));
		line.setAttribute('y2', String(y2));
		svg.style.display = 'block';
	}

	function hideStrokeLine() {
		if (strokeOverlay) strokeOverlay.svg.style.display = 'none';
	}

	let xHeld = false;
	let stroke = null;

	const cancelStroke = () => {
		stroke = null;
		hideStrokeLine();
	};

	window.addEventListener(
		'keydown',
		(event) => {
			if (event.code === 'Escape' && stroke) {
				event.preventDefault();
				cancelStroke();
				return;
			}
			if (
				event.code !== 'KeyX' ||
				event.ctrlKey ||
				event.altKey ||
				event.metaKey ||
				event.shiftKey
			) {
				return;
			}
			if (isTyping(event)) return;
			xHeld = true;
		},
		true,
	);

	window.addEventListener(
		'keyup',
		(event) => {
			if (event.code === 'KeyX') xHeld = false;
		},
		true,
	);

	window.addEventListener(
		'blur',
		() => {
			xHeld = false;
			cancelStroke();
		},
		true,
	);

	window.addEventListener(
		'pointerdown',
		(event) => {
			if (
				!xHeld ||
				event.button !== 0 ||
				event.ctrlKey ||
				event.altKey ||
				event.metaKey ||
				event.shiftKey
			) {
				return;
			}
			const target = event.target;
			if (!(target instanceof Element) || !target.closest('.vue-flow')) return;
			event.preventDefault();
			event.stopImmediatePropagation();
			stroke = {
				pointerId: event.pointerId,
				start: { x: event.clientX, y: event.clientY },
			};
			showStrokeLine(event.clientX, event.clientY, event.clientX, event.clientY);
		},
		true,
	);

	window.addEventListener(
		'pointermove',
		(event) => {
			if (!stroke || event.pointerId !== stroke.pointerId) return;
			event.preventDefault();
			event.stopImmediatePropagation();
			showStrokeLine(stroke.start.x, stroke.start.y, event.clientX, event.clientY);
		},
		true,
	);

	window.addEventListener(
		'pointerup',
		(event) => {
			if (!stroke || event.pointerId !== stroke.pointerId) return;
			event.preventDefault();
			event.stopImmediatePropagation();
			const start = stroke.start;
			const end = { x: event.clientX, y: event.clientY };
			cancelStroke();
			if (Math.hypot(end.x - start.x, end.y - start.y) < 6) return;
			try {
				const crossed = findCrossedEdges(start, end);
				if (!crossed.length) return;
				const result = insertTie(crossed);
				if (result) console.log('[zip-ties-ui] tie inserted', result);
			} catch (error) {
				console.error('[zip-ties-ui] insert failed', error);
			}
		},
		true,
	);

	window.addEventListener('pointercancel', cancelStroke, true);

	let debugEnabled = false;
	try {
		debugEnabled =
			localStorage.getItem('zipTies.debug') === '1' ||
			new URLSearchParams(location.search).has('zipTiesDebug');
	} catch {}
	window.addEventListener(
		'click',
		(event) => {
			const target = event.target instanceof Element ? event.target : null;
			const store = getWorkflowDocumentStore();
			const tie = tieWrapperForTarget(target, store);
			if (event.detail === 2 && tie && openTieNode(tie)) {
				event.preventDefault();
				event.stopImmediatePropagation();
				return;
			}
			if (tie) {
				const node = store?.getNodeById?.(tie.dataset.id);
				if (node?.parameters?.zipTieGroup) {
					syncGroupSelection(store, tie);
					return;
				}
			}
			syncGroupSelection(store);
		},
		true,
	);

	window.addEventListener(
		'dblclick',
		(event) => {
			if (!enabled) return;
			const target = event.target instanceof Element ? event.target : null;
			const tie = tieWrapperForTarget(target);
			if (!tie) return;
			if (openTieNode(tie)) {
				event.preventDefault();
				event.stopImmediatePropagation();
			}
		},
		true,
	);

	if (debugEnabled) {
		window.__zipTies = { version, findCrossedEdges, insertTie, getWorkflowDocumentStore, syncGroupTransform, transformPosition, normalizeTieGroups, selectedTieGroups, copyTieGroups, pasteTieClipboard, getNdvStore, openTieNode };
	}

	function installSaveGuard() {
		if (window.__zipTiesSaveGuardInstalled) return;
		const originalFetch = window.fetch;
		if (typeof originalFetch !== 'function') return;
		window.__zipTiesSaveGuardInstalled = true;
		window.fetch = function (input, init) {
			try {
				const url = typeof input === 'string' ? input : input?.url ?? '';
				const method = (
					init?.method ||
					(input instanceof Request ? input.method : 'GET')
				).toUpperCase();
				if (
					method === 'PATCH' &&
					/\/rest\/workflows\/[^/?#]+/.test(url) &&
					init &&
					typeof init.body === 'string'
				) {
					const payload = JSON.parse(init.body);
					if (Array.isArray(payload.nodes) && payload.connections) {
						const names = new Set(payload.nodes.map((node) => node.name));
						let changed = false;
						for (const [sourceName, types] of Object.entries(payload.connections)) {
							if (!names.has(sourceName)) {
								delete payload.connections[sourceName];
								changed = true;
								continue;
							}
							for (const lists of Object.values(types ?? {})) {
								if (!Array.isArray(lists)) continue;
								for (const list of lists) {
									if (!Array.isArray(list)) continue;
									for (let i = list.length - 1; i >= 0; i--) {
										const destination = list[i];
										if (!destination || !names.has(destination.node)) {
											list.splice(i, 1);
											changed = true;
										}
									}
								}
							}
						}
						if (changed) {
							init = { ...init, body: JSON.stringify(payload) };
							console.warn('[zip-ties-ui] removed dangling connections before save');
						}
					}
				}
			} catch {}
			return originalFetch.call(this, input, init);
		};
	}

	let scheduled = false;
	const scheduleUpdate = () => {
		if (scheduled) return;
		scheduled = true;
		requestAnimationFrame(() => {
			scheduled = false;
			updateArrowRules();
			observeCanvasNodes();
			scheduleLayout(true);
		});
	};

	const observer = new MutationObserver(scheduleUpdate);

	function start() {
		installSaveGuard();
		document.documentElement.classList.remove('zt-ctrl');
		updateArrowRules();
		observeCanvasNodes();
		scheduleLayout(true);
		for (const delay of [120, 500, 1500]) {
			setTimeout(() => applyPortLayout(true, true), delay);
		}
		observer.observe(document.documentElement, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: ['data-node-name'],
		});
		console.log('[zip-ties-ui] Ctrl mode active');
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', start, { once: true });
	} else {
		start();
	}

})();
