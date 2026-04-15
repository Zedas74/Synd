import { diffDeep, JSONPath, getByPath, setByPath, assertNoReferenceRedundancies } from './json_tools.mjs';

class SyndWatcher {
	/** @type {Synd} */ synd = undefined;
	/** @type {JSONPath} */ path = undefined; // Absolute JSON path within the synd data
	/** @type {HTMLElement|Attr} */ parent = undefined; // The DOM element or Attr into which the elements rendered by the watcher are inserted
	/** @type {Text} */ startNode = undefined; // Invisible node before this watcher's own elements within the parent
	/** @type {Text} */ endNode = undefined; // Invisible node after this watcher's own elements within the parent
	/** @type {(x:any)=>DocumentFragment} */ template = undefined; // The template function, usually an html`` function, that renders this watcher's own elements
	/** @type {{ renderContext?: { currentWatcher?: SyndWatcher } }} */ templateAPIState = undefined;
	/** @type {{for: SyndWatcher['for'], with: SyndWatcher['with'], set: SyndWatcher['set'], refresh: SyndWatcher['refresh']}} */ templateAPI = undefined;
	/** @type {boolean} */ forWatcher = false;
	/** @type {SyndWatcher[]} */ inners = undefined; // Inner watchers. These are stored here and also in the root synd!
	constructor(oParams) {
		Object.assign(this, oParams);
		this.templateAPIState = { renderContext: oParams.renderContext };
		this.templateAPI = Object.freeze({
			for: (path, template) => parent => this.renderFor(path, template, parent),
			with: (path, template) => parent => this.renderWith(path, template, parent),
			set: this.set,
			refresh: this.refresh,
		});
	}
	bindRenderContext(renderContext) {
		this.templateAPIState.renderContext = renderContext;
		for (const oInner of this.inners ?? [])
			oInner.bindRenderContext(renderContext);
	}
	render(data, renderContext, oRenderParent, oOwnerParent) {
		if (this.parent instanceof Attr)
			return this.renderAttribute(data, renderContext, oRenderParent, oOwnerParent);
		return this.wrapFragment(this.synd.renderTemplate(this.template, data, this, this.parent, renderContext, oRenderParent, oOwnerParent));
	}
	renderAttribute(data, renderContext, oRenderParent, oOwnerParent) {
		return this.synd.renderTemplateValue(this.template, data, this, this.parent, renderContext, oRenderParent, oOwnerParent);
	}
	wrapFragment(oContentFragment) { // Wraps the fragment between two nodes. If normalize is not used anywhere, this is perfect and invisible
		this.startNode = document.createTextNode(''); // document.createComment('synd:start');
		this.endNode = document.createTextNode(''); // document.createComment('synd:end');
		const oFragment = document.createDocumentFragment();
		oFragment.append(this.startNode, oContentFragment, this.endNode);
		return oFragment;
	}
	clearContentDOMNodes() {
		let oCurrent = this.startNode?.nextSibling;
		while (oCurrent && oCurrent !== this.endNode) {
			const oNext = oCurrent.nextSibling;
			oCurrent.remove();
			oCurrent = oNext;
		}
	}
	resolvePath(path = '') {
		if (path instanceof JSONPath)
			return path.length ? new JSONPath([...this.path, ...path]) : new JSONPath(this.path);
		if (path === '' || path === undefined)
			return new JSONPath(this.path);
		return new JSONPath([...this.path, ...new JSONPath(path)]);
	}
	hasPathPrefix(aPathPrefix) {
		if (!this.path || this.path.length < aPathPrefix.length)
			return false;
		for (let i = 0, il = aPathPrefix.length; i < il; i++)
			if (this.path[i] !== aPathPrefix[i])
				return false;
		return true;
	}
	rebasePath(aOldBasePath, aNewBasePath) {
		if (!this.path) return;
		if (this.hasPathPrefix(aOldBasePath))
			this.path = new JSONPath([...aNewBasePath, ...this.path.slice(aOldBasePath.length)]);
		for (const oInner of this.inners ?? [])
			oInner.rebasePath(aOldBasePath, aNewBasePath);
	}
	reindexInnerWatchers(iStart = 0) { // Reindexes JSONPath values by array index
		const aInners = this.inners ?? [];
		for (let i = iStart, il = aInners.length; i < il; i++) {
			const oInner = aInners[i];
			oInner.rebasePath(oInner.path, [...this.path, i]);
		}
	}
	renderFor(path, template, parent, renderContext = this.templateAPIState.renderContext) { // The parent group comes from html``, the other two are passed by the user
		if (!(parent instanceof Element))
			throw new TypeError('"for" must be used inside an element parent');
		if (!renderContext)
			throw new TypeError('Render context missing for "for"');
		if (template === undefined && typeof path === 'function') { template = path; path = '' }; // There may be no path
		const aFullPath = this.resolvePath(path);
		const aData = getByPath(this.synd.data, aFullPath);
		if (!Array.isArray(aData)) throw new TypeError('"for" only usable for arrays');
		const oRenderParent = renderContext.currentWatcher ?? this;
		const oBaseWatcher = new SyndWatcher({ synd: this.synd, path: aFullPath, parent, template, forWatcher: true, renderContext });
		const oAllItems = oBaseWatcher.wrapFragment(document.createDocumentFragment());
		aData.forEach((vVal, i) => {
			const oNewWatcher = new SyndWatcher({ synd: this.synd, path: new JSONPath([...aFullPath, i]), parent, template, renderContext });
			const oFragment = oNewWatcher.render(vVal, renderContext, oRenderParent, oBaseWatcher);
			this.synd.addWatcher(oNewWatcher);
			(oBaseWatcher.inners ??= []).push(oNewWatcher);
			oAllItems.insertBefore(oFragment, oBaseWatcher.endNode);
		});
		this.synd.addWatcher(oBaseWatcher);
		(oRenderParent.inners ??= []).push(oBaseWatcher);
		return oAllItems;
	}
	renderWith(path, template, parent, renderContext = this.templateAPIState.renderContext) { // The parent comes from html``, and the context is an Element or Attr
		const bAttributeBinding = parent instanceof Attr;
		if (!bAttributeBinding && !(parent instanceof Element))
			throw new TypeError('"with" must be used inside an element parent');
		if (!renderContext)
			throw new TypeError('Render context missing for "with"');
		// if (template === undefined && typeof path === 'function') { template = path; path = '' }; // There may be no path
		const aFullPath = this.resolvePath(path);
		const oData = getByPath(this.synd.data, aFullPath);
		if (typeof oData !== 'object' || Array.isArray(oData)) throw new TypeError('"with" only usable for objects');
		const oRenderParent = renderContext.currentWatcher ?? this;
		const oNewWatcher = new SyndWatcher({ synd: this.synd, path: aFullPath, parent, template, renderContext });
		const vResult = oNewWatcher.render(oData, renderContext, oRenderParent, oRenderParent);
		this.synd.addWatcher(oNewWatcher);
		(oRenderParent.inners ??= []).push(oNewWatcher);
		return vResult;
	}
	set = (path, value) => {
		if (value === undefined) { value = path; path = '' }; // There may be no path
		if (value instanceof Event) // Only the event object was passed
			value = value.target.value;
		setByPath(this.synd.data, this.resolvePath(path), value);
		this.synd.refresh();
	}
	refresh = () => {
		this.synd.refresh();
	}
	clearInnerWatchers() {
		while (this.inners?.length)
			this.synd.removeWatcher(this.inners[this.inners.length -1], this);
	}
	disconnect() {
		this.clearContentDOMNodes();
		this.startNode?.remove(); this.startNode = undefined;
		this.endNode?.remove(); this.endNode = undefined;
		this.clearInnerWatchers(); this.synd = undefined; this.path = undefined; this.parent = undefined; this.template = undefined; this.templateAPIState = undefined; this.templateAPI = undefined; 
	}
}
class Synd {
	/** @type {SyndWatcher} */
	#rootWatcher;
	/** @type {Map<string,Set<SyndWatcher>>} */
	#map = new Map(); // All watchers indexed by absolute JSONPath are stored here
	#backup;
	#data;
	#container;
	static #createRenderContext = () => ({ currentWatcher: undefined });
	/** @param {{ data: object, container: HTMLElement }} @param {Function} template */
	constructor({ data, container }, template) {
		assertNoReferenceRedundancies(data, 'synd data');
		this.#backup = structuredClone(data);
		this.#data = data;
		this.#container = container;
		const renderContext = Synd.#createRenderContext();
		this.#rootWatcher = new SyndWatcher({ synd: this, path: new JSONPath([]), parent: container, template, renderContext });
		this.#rootWatcher.bindRenderContext(renderContext);
		container.append(this.renderTemplate(template, data, this.#rootWatcher, container, renderContext, undefined, undefined));
	}
	get data() {
		return this.#data;
	}
	get container() {
		return this.#container;
	}
	#findWatcherParents(oTargetWatcher, oCurrentWatcher = this.#rootWatcher, oRenderParent = this.#rootWatcher) {
		for (const oInner of oCurrentWatcher?.inners ?? []) {
			const oChildRenderParent = oCurrentWatcher.forWatcher ? oRenderParent : oCurrentWatcher;
			if (oInner === oTargetWatcher)
				return { ownerParent: oCurrentWatcher, renderParent: oChildRenderParent };
			const oFound = this.#findWatcherParents(oTargetWatcher, oInner, oChildRenderParent);
			if (oFound)
				return oFound;
		}
	}
	renderTemplate(template, data, oWatcher, parent, renderContext, oRenderParent, oOwnerParent) {
		const oPrev = renderContext.currentWatcher;
		renderContext.currentWatcher = oWatcher;
		try {
			const oFragment = template(data, oWatcher.templateAPI, parent, oWatcher.path.asPath(), oRenderParent?.templateAPI, oOwnerParent?.templateAPI);
			if (oFragment === undefined || oFragment === null || oFragment === false)
				return document.createDocumentFragment();
			if (typeof(oFragment) === 'function')
				html.throwNestedRenderFunction(template);
			if (typeof(oFragment) !== 'object') {
				const o = document.createDocumentFragment();
				o.append(document.createTextNode(String(oFragment)));
				return o;
			}
			return oFragment;
		} finally {
			renderContext.currentWatcher = oPrev;
		}
	}
	renderTemplateValue(template, data, oWatcher, parent, renderContext, oRenderParent, oOwnerParent) {
		const oPrev = renderContext.currentWatcher;
		renderContext.currentWatcher = oWatcher;
		try {
			const vValue = template(data, oWatcher.templateAPI, parent, oWatcher.path.asPath(), oRenderParent?.templateAPI, oOwnerParent?.templateAPI);
			if (typeof(vValue) === 'function')
				html.throwNestedRenderFunction(template);
			const sType = typeof vValue;
			if (sType !== 'string' && sType !== 'number' && sType !== 'boolean')
				throw new TypeError('Attribute binding only usable for string, number or boolean values');
			return vValue;
		} finally {
			renderContext.currentWatcher = oPrev;
		}
	}
	addWatcher(oNewWatcher) {
		const sKey = oNewWatcher.path.asKey();
		let osMapNode = this.#map.get(sKey);
		if (!osMapNode)
			this.#map.set(sKey, osMapNode = new Set());
		osMapNode.add(oNewWatcher);
	}
	#removeWatcherFromMap(oWatcher) {
		const sKey = oWatcher.path.asKey();
		const osMapNode = this.#map.get(sKey);
		if (!osMapNode)
			return;
		osMapNode.delete(oWatcher);
		if (osMapNode.size === 0)
			this.#map.delete(sKey);
	}
	#removeWatcherSubtreeFromMap(oWatcher) {
		this.#removeWatcherFromMap(oWatcher);
		for (const oInner of oWatcher.inners ?? [])
			this.#removeWatcherSubtreeFromMap(oInner);
	}
	#addWatcherSubtreeToMap(oWatcher) {
		this.addWatcher(oWatcher);
		for (const oInner of oWatcher.inners ?? [])
			this.#addWatcherSubtreeToMap(oInner);
	}
	removeWatcher(oWatcher, oOwnerWatcher = this.#findWatcherParents(oWatcher)?.ownerParent) {
		this.#removeWatcherFromMap(oWatcher);
		const aOwnedWatchers = oOwnerWatcher?.inners;
		if (aOwnedWatchers) {
			const iIndex = aOwnedWatchers.indexOf(oWatcher);
			if (iIndex !== -1)
				aOwnedWatchers.splice(iIndex, 1);
		}
		oWatcher.disconnect();
	}
	/** @param {SyndWatcher} */
	#update(oWatcher, renderContext, oRenderParent, oOwnerParent) {
		if (oWatcher.parent instanceof Attr) {
			oWatcher.clearInnerWatchers();
			const vValue = oWatcher.renderAttribute(getByPath(this.#data, oWatcher.path), renderContext, oRenderParent, oOwnerParent);
			html.applyAttributeBindingValue(oWatcher.parent, vValue);
			return;
		}
		oWatcher.clearInnerWatchers();
		oWatcher.clearContentDOMNodes();
		oWatcher.parent.insertBefore(this.renderTemplate(oWatcher.template, getByPath(this.#data, oWatcher.path), oWatcher, oWatcher.parent, renderContext, oRenderParent, oOwnerParent), oWatcher.endNode);
	}
	#insert(oBaseWatcher, iInnerIndex, aData, renderContext, oRenderParent) {
		const { path, parent, template } = oBaseWatcher;
		const inners = oBaseWatcher.inners ??= [];
		const oBaseChild = inners[iInnerIndex]?.startNode ?? oBaseWatcher.endNode;
		// Remove watchers after the insertion point from the map
		for (let i = iInnerIndex, il = inners.length; i < il; i++)
			this.#removeWatcherSubtreeFromMap(inners[i]);
		aData.forEach((vVal, i) => {
			const oNewWatcher = new SyndWatcher({ synd: this, path: new JSONPath([...path, iInnerIndex +i]), parent, template, renderContext });
			const oFragment = oNewWatcher.render(vVal, renderContext, oRenderParent, oBaseWatcher);
			this.addWatcher(oNewWatcher);
			inners.splice(iInnerIndex +i, 0, oNewWatcher);
			parent.insertBefore(oFragment, oBaseChild);
		});
		// Re-add watchers after the insertion point to the map
		oBaseWatcher.reindexInnerWatchers(iInnerIndex +aData.length);
		for (let i = iInnerIndex +aData.length, il = inners.length; i < il; i++) {
			this.#addWatcherSubtreeToMap(inners[i]);
		}
	}
	#delete(oBaseWatcher, iInnerIndex, iLength) {
		const { inners } = oBaseWatcher;
		// Remove watchers after the deletion point from the map
		for (let i = iInnerIndex +iLength, il = inners.length; i < il; i++)
			this.#removeWatcherSubtreeFromMap(inners[i]);
		for (let i = iInnerIndex +iLength -1; i >= iInnerIndex; i--) {
			const oWatcher = inners[i];
			this.removeWatcher(oWatcher, oBaseWatcher);
		}
		// Re-add watchers after the insertion point to the map
		oBaseWatcher.reindexInnerWatchers(iInnerIndex);
		for (let i = iInnerIndex, il = inners.length; i < il; i++) {
			this.#addWatcherSubtreeToMap(inners[i]);
		}
	}
	#selectWatchersForDiff(aWatchersAtPath, sType) {
		const aArrayWatchers = aWatchersAtPath.filter(oWatcher => oWatcher.forWatcher);
		const aPlainWatchers = aWatchersAtPath.filter(oWatcher => !oWatcher.forWatcher);

		if (sType === 'ins' || sType === 'del') // For ins/del, array watchers have priority
			return aArrayWatchers.length ? aArrayWatchers : aPlainWatchers; 
		return aPlainWatchers.length ? aPlainWatchers : aArrayWatchers; // For val/set/rem, plain watchers have priority
	}
	#applyDiffsAndSync(aDiffs, renderContext) {
		aDiffs.forEach(([aDiffPath, sType, vKey, vVal]) => {
			const sDiffKey = aDiffPath.asKey();
			const aWatchersAtPath = Array.from(this.#map.get(sDiffKey) ?? []);
			const aWatchers = this.#selectWatchersForDiff(aWatchersAtPath, sType);
			for (const oWatcher of aWatchers) {
				if (oWatcher.synd !== this)
					continue;
				const oParents = this.#findWatcherParents(oWatcher);
				const oOwnerParent = oParents?.ownerParent;
				const oRenderParent = oParents?.renderParent;
				if (sType === 'ins') {
					if (oWatcher.forWatcher)
						this.#insert(oWatcher, vKey, vVal, renderContext, oRenderParent);
					else
						this.#update(oWatcher, renderContext, oRenderParent, oOwnerParent);
				}
				else if (sType === 'del') {
					if (oWatcher.forWatcher)
						this.#delete(oWatcher, vKey, vVal);
					else
						this.#update(oWatcher, renderContext, oRenderParent, oOwnerParent);
				}
				else
					this.#update(oWatcher, renderContext, oRenderParent, oOwnerParent);
			}
		});
		aDiffs.forEach(([aDiffPath, sType, vKey, vVal]) => {
			const backup = getByPath(this.#backup, aDiffPath);

			switch (sType) {
				case 'val':
				case 'set':
					backup[vKey] = structuredClone(vVal);
					break;
				case 'ins':
					backup.splice(vKey, 0, ...structuredClone(vVal));
					break;
				case 'del':
					backup.splice(vKey, vVal);
					break;
				case 'rem':
					delete backup[vKey];
					break;
			}
		});
	}
	refresh() {
		assertNoReferenceRedundancies(this.#data, 'synd data');
		const aDiffs = diffDeep(this.#backup, this.#data);
		const renderContext = Synd.#createRenderContext();
		this.#rootWatcher.bindRenderContext(renderContext);
		this.#applyDiffsAndSync(aDiffs, renderContext);
	}
	disconnect() {
		this.#rootWatcher?.disconnect(); this.#rootWatcher = undefined;
		this.#map?.clear(); this.#map = undefined;
		this.#backup = undefined; this.#data = undefined;
	}
	dump() {
		if (!this.#map) {
			return {
				disconnected: true,
				reachableWatcherCount: 0,
				indexedWatcherCount: 0,
				mapPathCount: 0,
				root: null,
				paths: [],
				danglingIndexedWatchers: [],
				unindexedReachableWatchers: []
			};
		}

		const formatPath = oWatcher => {
			if (!oWatcher?.path)
				return '<disconnected>';
			const sPath = oWatcher.path.asPath();
			return sPath || '<root>';
		};
		const describeWatcher = oWatcher => ({
			path: formatPath(oWatcher),
			type: oWatcher.forWatcher ? 'for' : 'watch',
			innerCount: oWatcher.inners?.length ?? 0,
			connected: Boolean(oWatcher.startNode?.isConnected || oWatcher.endNode?.isConnected || oWatcher.parent instanceof Attr)
		});
		const describeTree = oWatcher => ({
			...describeWatcher(oWatcher),
			children: (oWatcher?.inners ?? []).map(describeTree)
		});

		const osReachable = new Set();
		const aReachable = [];
		const visit = oWatcher => {
			if (!oWatcher || osReachable.has(oWatcher))
				return;
			osReachable.add(oWatcher);
			aReachable.push(oWatcher);
			for (const oInner of oWatcher.inners ?? [])
				visit(oInner);
		};
		visit(this.#rootWatcher);

		const aIndexedWatchers = [];
		const aPaths = Array.from(this.#map.values(), osWatchers => {
			const aWatchers = Array.from(osWatchers);
			aIndexedWatchers.push(...aWatchers);
			return {
				path: formatPath(aWatchers[0]),
				count: aWatchers.length,
				watchers: aWatchers.map(describeWatcher)
			};
		}).sort((a, b) => a.path.localeCompare(b.path));

		const osIndexed = new Set(aIndexedWatchers);
		return {
			disconnected: false,
			reachableWatcherCount: aReachable.length,
			indexedWatcherCount: aIndexedWatchers.length,
			mapPathCount: this.#map.size,
			root: describeTree(this.#rootWatcher),
			paths: aPaths,
			danglingIndexedWatchers: aIndexedWatchers.filter(oWatcher => !osReachable.has(oWatcher)).map(describeWatcher),
			unindexedReachableWatchers: aReachable.filter(oWatcher => oWatcher !== this.#rootWatcher && !osIndexed.has(oWatcher)).map(describeWatcher)
		};
	}
}
function synd(oParams, template) {
	return new Synd(oParams, template);
}

// ────────────────────────────────────────────────────────────────────────────

function svg(first, ...rest) {
	if (Array.isArray(first))
		return html.parser(first, rest, [], true); // svg`...`
	return (aChunks, ...aValues) => html.parser(aChunks, aValues, [first, ...rest], true); // svg('a', 1)`...`
}
svg.namespace = 'http://www.w3.org/2000/svg';

function html(first, ...rest) {
	if (Array.isArray(first))
		return html.parser(first, rest); // html`...`	
	return (aChunks, ...aValues) => html.parser(aChunks, aValues, [first, ...rest]); // html('a', 1)`...`
}
html.throwNestedRenderFunction = (position) => {
	throw new TypeError('Render function leaked into output. If you return {synd}.for(...) or {synd}.with(...) from another callback, wrap it in html`<div>${...}</div>` or another element.\n' +position.toString());
};
html.throwMixedAttributeValue = (sAttrName, sSnippet) => {
	throw new TypeError(`Mixed static and dynamic content in attribute '${sAttrName}' at '${String(sSnippet)}'. Use a fully dynamic attribute value instead.`);
};
html.isIgnorableValue = v => v === undefined || v === null;
html.lowerCase = s => s.slice(2, 3).toLowerCase() +s.slice(3);
html.applyAttributeBindingValue = (oAttr, vValue) => {
	const sValue = String(vValue);
	oAttr.value = sValue;
	if (oAttr.ownerElement?.namespaceURI !== svg.namespace)
		oAttr.ownerElement[oAttr.name] = sValue;
};
html.reToken = /(<!\-\-(.*?)\-\->|<([a-zA-Z][a-zA-Z0-9-]*)|\s+([a-zA-Z-]+)="(.*?)"|\s+([a-zA-Z-]+)="|\s+([a-zA-Z-]+)(?=\s|\/?>)|(")|(\/?>)|<\/([a-zA-Z][a-zA-Z0-9-]*)>)/gms;
html.reOn = /^on[A-Z]/;
html.rePs = /^ps[A-Z]/
html.parser = (aChunks, aValues, aExtraParams = [], bSvg = false) => {
	const oResult = document.createDocumentFragment();
	const createElement = bSvg ? tag => document.createElementNS(svg.namespace, tag) : tag => document.createElement(tag);

	const appendValue = (value, chunk) => {
		if (html.isIgnorableValue(value)) return;
		if (typeof value === 'function') {
			value = value(oParent, ...aExtraParams);
			if (typeof value === 'function')
				html.throwNestedRenderFunction(chunk);
		}
		if (Array.isArray(value)) {
			for (const item of value) appendValue(item, chunk);
			return;
		}
		if (value instanceof Node) {
			oParent.append(value);
			return;
		}
		oParent.append(document.createTextNode(String(value)));
	};

	let oCurrentElement, oParent = oResult, bQuoteExpected, bAttributeExpected, aClosers = [], sPendingLiveAttributeName;
	const changeToCustomElement = sIs => { // Replaces the current element with a customized built-in
		const oCustomElement = document.createElement(oCurrentElement.localName, { is: sIs });
		for (const oAttr of oCurrentElement.attributes)
			oCustomElement.setAttribute(oAttr.name, oAttr.value);
		oCurrentElement.replaceWith(oCustomElement);
		oCurrentElement = oCustomElement;
		aClosers.at(-1)[1] = oCustomElement;
		oParent = oCustomElement;
	};
	aChunks.forEach((sChunk, c) => {
		html.reToken.lastIndex = 0;
		let m, iPrevEnd = 0, bValueUsed = false;
		while (m = html.reToken.exec(sChunk)) {
			const [,, cmt, eln, atn, atv, atl, ats, quo, elc, cle] = m;
			const iCurrentPos = m.index;
			const iTextStart = iPrevEnd;
			const bTagOnlyToken = atn !== undefined || atl !== undefined || ats !== undefined || quo !== undefined || elc !== undefined;
			if (cmt !== undefined) {
				if (bAttributeExpected || bQuoteExpected)
					throw new TypeError(`Comment not allowed in element declaration at '${sChunk.slice(iCurrentPos)}'`);
				oParent.append(document.createComment(cmt));
				iPrevEnd = html.reToken.lastIndex;
				continue;
			}
			if (bTagOnlyToken && !bAttributeExpected && !bQuoteExpected)
				continue;
			const sText = sChunk.slice(iTextStart, iCurrentPos);
			if (bQuoteExpected && sText) {
				if (sPendingLiveAttributeName)
					html.throwMixedAttributeValue(sPendingLiveAttributeName, sChunk.slice(iTextStart));
				throw new TypeError(`Quote missing at '${sChunk.slice(iTextStart)}'`);
			}
			if (bAttributeExpected) {
				if (sText.trim())
					throw new TypeError(`Attribute expected at '${sChunk.slice(iTextStart)}'`);
			} else if (sText)
				appendValue(sText, sChunk);
			iPrevEnd = html.reToken.lastIndex;
			if (bQuoteExpected && quo === undefined)
				throw new TypeError(`Quote missing at '${sChunk.slice(iCurrentPos)}'`);
			if (bAttributeExpected && atn === undefined && atl === undefined && ats === undefined && quo === undefined && elc === undefined)
				throw new TypeError(`Attribute expected at '${sChunk.slice(iCurrentPos)}'`);

			if (eln !== undefined) { // Element name
				oCurrentElement = createElement(eln);
				oParent.append(oCurrentElement);
				oParent = oCurrentElement;
				bAttributeExpected = true;
				aClosers.push([eln, oCurrentElement, []]);
			} else if (atn !== undefined && atv !== undefined) { // Attribute
				if (atn === 'is')
					changeToCustomElement(atv);
				oCurrentElement.setAttribute(atn, atv);
			} else if (atl !== undefined) { // Live attribute
				const value = aValues[c], vfn = typeof value === 'function';
				if (html.reOn.test(atl) && vfn) {
					oCurrentElement.addEventListener(html.lowerCase(atl), value);
				} else if (html.rePs.test(atl)) {
					const sName = html.lowerCase(atl);
					const oAttr = document.createAttribute(sName);
					aClosers.at(-1)[2].push([oAttr, vfn ? value(oAttr) : value]);
				} else {
					const oAttr = document.createAttribute(atl);
					oCurrentElement.setAttributeNode(oAttr);
					html.applyAttributeBindingValue(oAttr, vfn ? value(oAttr) : value);
					// o.setAttribute(atl, vfn ? String(value()) : value);
				}
				bValueUsed = true;
				bQuoteExpected = true;
				sPendingLiveAttributeName = atl;
			} else if (ats !== undefined) { // Solo attribute
				oCurrentElement.setAttribute(ats, ats);
			} else if (quo !== undefined) { // Quote
				bQuoteExpected = false;
				sPendingLiveAttributeName = undefined;
			} else if (elc !== undefined) { // Element closer
				if (elc[0] === '/') { // Self close
					let aTimedAttrs, oCloser;
					oCloser = aClosers.pop();
					if (!oCloser)
						throw new TypeError(`Unexpected self-close '${elc}' at '${sChunk.slice(iCurrentPos)}'. No open element is available to close.`);
					[, oCurrentElement, aTimedAttrs] = oCloser;
					aTimedAttrs.forEach(([oAttr, vVal]) => {
						oCurrentElement.setAttributeNode(oAttr);
						html.applyAttributeBindingValue(oAttr, vVal);
					});
					oParent = oParent ? oParent.parentNode : oResult;
				}
				bAttributeExpected = false;
			} else if (cle !== undefined) { // Closer element
				let sPrev, aTimedAttrs, oCloser;
				oCloser = aClosers.pop();
				if (!oCloser)
					throw new TypeError(`Unexpected close element '</${cle}>' at '${sChunk.slice(iCurrentPos)}'. No open element is available to close.`);
				[sPrev, oCurrentElement, aTimedAttrs] = oCloser;
				if (sPrev !== cle)
					throw new TypeError(`Invalid close element '${sPrev}' vs '${cle}'`);
				aTimedAttrs.forEach(([oAttr, vVal]) => {
					oCurrentElement.setAttributeNode(oAttr);
					html.applyAttributeBindingValue(oAttr, vVal);
				});
				oParent = oParent ? oParent.parentNode : oResult;
				bAttributeExpected = false;
			}
		}

		const sTailText = sChunk.slice(iPrevEnd);
		if (sTailText) {
			if (bQuoteExpected) {
				if (sPendingLiveAttributeName)
					html.throwMixedAttributeValue(sPendingLiveAttributeName, sTailText);
				throw new TypeError(`Quote missing at '${sTailText}'`);
			}
			if (bAttributeExpected) {
				if (sTailText.trim())
					throw new TypeError(`Attribute expected at '${sTailText}'`);
			} else
				appendValue(sTailText, sTailText);
		}

		if (!bValueUsed && c < aValues.length) {
			if (bAttributeExpected && !html.isIgnorableValue(aValues[c]))
				throw new TypeError('Unexpected value in element declaration');
			appendValue(aValues[c], sChunk);
		}
	});
	if (bQuoteExpected)
		throw new TypeError('Quote missing at end of template');
	if (bAttributeExpected)
		throw new TypeError(`Element closer missing for '${aClosers[aClosers.length -1][0]}'`);
	if (aClosers.length)
		throw new TypeError(`Close element missing for '${aClosers[aClosers.length -1][0]}'`);
	return oResult;
}

export { html, svg, synd };