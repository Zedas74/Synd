class JSONPath extends Array {
    static #reToken = /(\.(?<p>[A-Za-z_$][A-Za-z0-9_$]*)|\[(?<q1>(["']|))(?<n>\d+)\k<q1>\]|\[(?<q2>["'])(?<s>(?:\\.|(?!\k<q2>).)*)\k<q2>\])/gy;
    static #reUnescape = s => s.replace(/\\(.)/g, '$1');
    static #reIdent = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
    static #escape = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

    constructor(sPath) {
        if (typeof(sPath) === 'string') {
            super();

            if (!sPath.length) throw new SyntaxError(`JSONPath: path must not be empty`);

            JSONPath.#reToken.lastIndex = 0;
            let m, i = 0;

            while (m = JSONPath.#reToken.exec(sPath)) {
                if (m.index !== i) throw new SyntaxError(`JSONPath: invalid path segment at position ${i}`);
                const {p, s, n} = m.groups;
                if (p)
                    this.push(p);
                else if (s)
                    this.push(JSONPath.#reUnescape(s));
                else
                    this.push(parseInt(n));

                i = JSONPath.#reToken.lastIndex;
            }
            if (i !== sPath.length) throw new SyntaxError(`JSONPath: invalid path segment at position ${i}`);
        } else if (Array.isArray(sPath)) {
            super();
            if (sPath.length)
                this.push(...sPath);
        } else
            super();
    }

    asKey() {
        return Array.from(this, v => v +'\0').join('');
    }

    asPath() {
        return Array.from(this, v => 
            typeof(v) === 'number' ? `[${v}]` :
            JSONPath.#reIdent.test(v) ? `.${v}` :
            `['${JSONPath.#escape(v)}']`).join('');
    }
}

/**
 * JavaScript-szerű útvonal alapján értéket olvas ki objektumból/tömbből.
 * A path lehet string vagy JSONPath; JSONPath esetén nem történik újraparszolás.
 * Támogatott szintaxis stringnél: `.prop`, `[7]`, `["x.y"]`, `['x y']`, kombinálva.
 * Ha bármely köztes szint hiányzik vagy nem objektum/tömb, `undefined`-ot ad vissza.
 * @param {any} target
 * @param {string|JSONPath} path
 * @returns {any}
 */
function getByPath(target, path) {
    if (target === null || typeof(target) !== 'object')
        throw new TypeError('getByPath: target must be an object or array');
    if (typeof(path) !== 'string' && !(path instanceof JSONPath))
        throw new TypeError('getByPath: path must be a string or JSONPath');

    let o = target;
    const aTokens = path instanceof JSONPath ? path : new JSONPath(path);
    for (let s of aTokens) {
        if (o === undefined || o === null || typeof(o) !== 'object')
            return undefined;
        o = o[s];
    }

    return o;
}

/**
 * @typedef {'val'|'set'|'rem'|'ins'|'del'} DiffKind
 * @typedef {[path:JSONPath, type:DiffKind, key:string|number|undefined, value:any]} DiffEntry
 */

/**
 * Mély összehasonlítást végez és visszaadja a különbségeket.
 * @param {any} a
 * @param {any} b
 * @returns {DiffEntry[]}
 */
function diffDeep(a, b) {
    /** @typeof {[DiffEntry]} */
    const aResult = [];
    const osVisited = new Set();

    const extendPath = (aPath, xKey) => xKey === undefined ? aPath : new JSONPath([...aPath, xKey]);

    const diff = (aParentPath, xKey, a, b, aCollector = aResult, osLocalVisited = osVisited) => {
        if (a !== null && typeof(a) === 'object')
            osLocalVisited.add(a);
        if (a === b) return;
        const ta = typeof(a), tb = typeof(b);
        if (ta !== tb || diffDeep.typeOf(a) !== diffDeep.typeOf(b) || ta !== 'object' || a === null || b === null) {
            aCollector.push([aParentPath, 'val', xKey, b]);
            return;
        }

        const aPath = extendPath(aParentPath, xKey);

        // Tömb teszt
        if (Array.isArray(a)) {
            const omEqualPairs = new Map();
            const getPairKey = (iA, iB) => `${iA}|${iB}`;
            const areArrayItemsEqual = (iA, iB) => {
                const sPairKey = getPairKey(iA, iB);
                if (omEqualPairs.has(sPairKey))
                    return omEqualPairs.get(sPairKey);
                if (a[iA] === b[iB]) {
                    omEqualPairs.set(sPairKey, true);
                    return true;
                }

                const aProbe = [];
                diff(new JSONPath(), undefined, a[iA], b[iB], aProbe, new Set());
                const bEqual = !aProbe.length;
                omEqualPairs.set(sPairKey, bEqual);
                return bEqual;
            };

            const checkRange = (iStartA, iStartB, iCount) => {
                for (let i = 0; i < iCount; i++) {
                    const iA = iStartA +i;
                    const iB = iStartB +i;
                    if (omEqualPairs.get(getPairKey(iA, iB)))
                        continue;
                    if (!osLocalVisited.has(a[iA]))
                        diff(aPath, iA, a[iA], b[iB], aCollector, osLocalVisited);
                    else if (a[iA] !== b[iB]) 
                        aCollector.push([aPath, 'val', iA, b[iB]]);
                }
            };

            const iALen = a.length, iBLen = b.length;
            if (iALen === iBLen) {
                checkRange(0, 0, iALen);
                return;
            }

            const iMLen = Math.min(iALen, iBLen);
            let iPrefix = 0;
            while (iPrefix < iMLen && areArrayItemsEqual(iPrefix, iPrefix))
                iPrefix++;

            let iSuffix = 0, iAEnd = iALen - iPrefix, iBEnd = iBLen - iPrefix;
            while (iSuffix < iAEnd && iSuffix < iBEnd && areArrayItemsEqual(iALen -1 -iSuffix, iBLen -1 -iSuffix))
                iSuffix++;

            const iAEndMid = iALen -iSuffix, iBEndMid = iBLen -iSuffix, 
                iAMidLen = iAEndMid -iPrefix, iBMidLen = iBEndMid -iPrefix, iCommonMid = Math.min(iAMidLen, iBMidLen);

            if (iPrefix > 0) checkRange(0, 0, iPrefix);
            if (iCommonMid > 0) checkRange(iPrefix, iPrefix, iCommonMid);
            if (iAMidLen < iBMidLen)
                aCollector.push([aPath, 'ins', iPrefix +iCommonMid, b.slice(iPrefix +iCommonMid, iBEndMid)]);
            else if (iAMidLen > iBMidLen)
                aCollector.push([aPath, 'del', iPrefix +iCommonMid, iAMidLen -iCommonMid]);

            if (iSuffix > 0) checkRange(iAEndMid, iBEndMid, iSuffix);
            return;
        }

        // Objektum teszt
        const osAKeys = new Set(Object.keys(a));
        const osBKeys = new Set(Object.keys(b));
        osAKeys.intersection(osBKeys).forEach(s => {
            if (!osLocalVisited.has(a[s]))
                diff(aPath, s, a[s], b[s], aCollector, osLocalVisited);
        });
        // A régiben van, de az újban nincs -> jelentés: a szülő úton, 'rem', kulcs
        osAKeys.difference(osBKeys).forEach(s => aCollector.push([aPath, 'rem', s, undefined]));
        // Az újban van, de a régiben nincs -> jelentés: a szülő úton, 'set', kulcs, új érték
        osBKeys.difference(osAKeys).forEach(s => aCollector.push([aPath, 'set', s, b[s]]));
    }

    diff(new JSONPath(), undefined, a, b);
    return aResult;
}
diffDeep.typeOf = o => {
	if (o === undefined) return 'undefined';
	if (o === null) return 'null';
	if (Array.isArray(o)) return 'array';
	return typeof(o);
}

/**
 * @template T
 * Mélyen összefésüli a forrás objektumokat a targetbe.
 * Objektumoknál rekurzívan merge-el, egyéb típusoknál felülír.
 * Tömböknél index-alapon ír felül (a target hossza nem csökken automatikusan).
 * @param {T} target
 * @param {...any} sources
 * @returns {T}
 */
function mergeDeep(target, ...sources) {
	if (typeof(target) === 'object' && target)
		for (const source of sources)
			if (typeof(source) === 'object' && source)
				mergeDeep.merge(target, source);
	return target;
}
mergeDeep.merge = (target, source) => {
    for (const k of Object.keys(source)) {
		const s = source[k];
		const t = target[k];
		if ((typeof(s) === 'object' && s) && (typeof(t) === 'object' && t))
			mergeDeep.merge(t, s);
		else
			target[k] = s;
	}
};

/**
 * @template T
 * Mélyen rákényszeríti a targetet a source struktúrájára.
 * A forrásban nem szereplő kulcsokat törli a targetből.
 * Tömböknél a cél tömb hosszát is a forráséhoz igazítja.
 * @param {T} target
 * @param {...any} sources
 * @returns {T}
 */
function forceDeep(target, ...sources) {
    if (typeof(target) === 'object' && target)
        for (const source of sources)
            if (typeof(source) === 'object' && source)
                forceDeep.merge(target, source);
    return target;
}
forceDeep.merge = (target, source) => {
    for (const k of Object.keys(source)) {
        const t = target[k];
        const s = source[k];
        if ((typeof(s) === 'object' && s) && (typeof(t) === 'object' && t)) {
            forceDeep.merge(t, s);
            if (Array.isArray(s) && Array.isArray(t))
                t.length = s.length;
        } else
            target[k] = s;
    }
    for (const k of Object.keys(target))
        if (!Object.prototype.hasOwnProperty.call(source, k))
            delete target[k];
};

/**
 * Mélyen kitakarítja az üres objektumokat/tömböket egy objektumfából.
 * `true`-t ad vissza, ha a bemenet teljesen kiüríthető;
 * `false`-t, ha maradt benne legalább egy nem törölhető érték.
 * @param {any} o
 * @returns {boolean}
 */
function cleanDeep(o) {
    if (o === undefined)
        return false;
    if (typeof(o) !== 'object')
        return false;
    if (o === null)
        return false;
    if (Array.isArray(o)) {
        for (let i = o.length -1; i >= 0; i--)
            if (cleanDeep(o[i]))
                delete o[i];
        if (!o.length)
            return true;
        return false;
    }
    const a = Object.keys(o);
    for (let i = a.length -1; i >= 0; i--) {
        const c = a[i];
        if (cleanDeep(o[c]))
            delete o[c];
    }
    return !Object.keys(o).length;
}

/**
 * Mély kulcs-átalakítás objektumokon.
 * A mapper `[kulcs, érték]` párost kap, és vagy új párt ad vissza,
 * vagy falsy értékkel eldobja az adott kulcsot.
 * @template T
 * @param {T} source
 * @param {(entry:[string, any]) => [string, any] | null | undefined | false} fKeyMapper
 * @returns {T}
 */
function mapDeep(source, fKeyMapper) {
	if (Array.isArray(source))
		return source.map(v => mapDeep(v, fKeyMapper));
	if (source !== null && typeof(source) === 'object') {
		return Object.fromEntries(
			Object.entries(source).map(([k, v]) => fKeyMapper([k, mapDeep(v, fKeyMapper)])).filter(s => s)
		);
	}
	return source;
}

/**
 * JavaScript-szerű útvonal alapján értéket állít be objektumban/tömbben.
 * A path lehet string vagy JSONPath; JSONPath esetén nem történik újraparszolás.
 * Támogatott szintaxis stringnél: `.prop`, `[7]`, `["x.y"]`, `['x y']`, kombinálva.
 * Hiányzó köztes szinteket létrehozza (`{}` vagy `[]` a következő token szerint).
 * @template T
 * @param {T} target
 * @param {string|JSONPath} sPath
 * @param {any} value
 * @returns {T}
 */
function setByPath(target, sPath, value) {
    if (target === null || typeof(target) !== 'object')
        throw new TypeError('setByPath: target must be an object or array');
    if (typeof(sPath) !== 'string' && !(sPath instanceof JSONPath))
        throw new TypeError('setByPath: path must be a string or JSONPath');

    const aTokens = sPath instanceof JSONPath ? sPath : new JSONPath(sPath);
    if (!aTokens.length)
        throw new TypeError('setByPath: path must not be empty');

    let oCurrent = target;
    for (let i = 0; i < aTokens.length; i++) {
        const token = aTokens[i];
        const bLast = i === aTokens.length - 1;
        if (bLast) {
            oCurrent[token] = value;
            return target;
        }

        const nextToken = aTokens[i + 1];
        let oNext = oCurrent[token];
        if (oNext === null || typeof(oNext) !== 'object') {
            oNext = typeof(nextToken) === 'number' ? [] : {};
            oCurrent[token] = oNext;
        }
        oCurrent = oNext;
    }

    return target;
}

/**
 * Mély egyenlőségvizsgálat primitívekre, tömbökre és objektumokra.
 * Ciklikus hivatkozás esetén a már bejárt bal oldali referencia-ágat
 * újra nem bontja tovább, hanem referencia-szinten hasonlít.
 * @param {any} a
 * @param {any} b
 * @param {Set<any>} [osVisited]
 * @returns {boolean}
 */
function equalDeep(a, b, osVisited = new Set()) {
    if (a === b) return true;
    if (typeof(a) !== typeof(b)) return false;
    if (a === null || b === null) return false;
    if (typeof(a) !== 'object') return false;

    osVisited.add(a);

    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++)
            if (osVisited.has(a[i])) { // Ha rekurzió lenne, nem megy bele az objektumokba
                if (a[i] !== b[i])
                    return false;
            } else if (!equalDeep(a[i], b[i], osVisited)) return false;
        return true;
    }

    const aKeyA = Object.keys(a);
    const aKeyB = Object.keys(b);
    const iALen = aKeyA.length;
    if (iALen !== aKeyB.length) return false;

    const aSortA = aKeyA.sort();
    const aSortB = aKeyB.sort();
    for (let i = 0; i < iALen; i++) {
        const sKeyA = aSortA[i];
        const sKeyB = aSortB[i]
        if (sKeyA !== sKeyB) return false;
        if (osVisited.has(a[sKeyA])) {
            if (a[sKeyA] !== b[sKeyB])
                    return false;
        }
        if (!equalDeep(a[sKeyA], b[sKeyB], osVisited)) return false;
    }

    return true;
}

/**
 * Megkeresi azokat az objektum- vagy tömbreferenciákat, amelyek több,
 * nem ciklikus útvonalon is elérhetők ugyanabban az adatfában.
 * @param {any} target
 * @returns {{firstPath: JSONPath, duplicatePath: JSONPath}[]}
 */
function findReferenceRedundancies(target) {
    /** @type {{firstPath: JSONPath, duplicatePath: JSONPath}[]} */
    const aResult = [];
    if (target === null || typeof(target) !== 'object')
        return aResult;

    const omSeen = new WeakMap();
    const osStack = new WeakSet();

    const crawler = (value, aPath) => {
        if (value === null || typeof(value) !== 'object')
            return;
        if (osStack.has(value))
            return;

        const aFirstPath = omSeen.get(value);
        if (aFirstPath) {
            aResult.push({ firstPath: aFirstPath, duplicatePath: aPath });
            return;
        }

        omSeen.set(value, aPath);
        osStack.add(value);
        if (Array.isArray(value)) {
            value.forEach((item, i) => crawler(item, new JSONPath([...aPath, i])));
        } else {
            Object.keys(value).forEach(sKey => crawler(value[sKey], new JSONPath([...aPath, sKey])));
        }
        osStack.delete(value);
    };

    crawler(target, new JSONPath());
    return aResult;
}

/**
 * Hibát dob, ha az adatfában ugyanaz az objektum több, nem ciklikus
 * útvonalon is szerepel.
 * @param {any} target
 * @param {string} [sLabel='data']
 */
function assertNoReferenceRedundancies(target, sLabel = 'data') {
    const aRedundancies = findReferenceRedundancies(target);
    if (!aRedundancies.length)
        return;

    const formatPath = aPath => aPath.asPath() || '<root>';
    const sPreview = aRedundancies.slice(0, 3)
        .map(({ firstPath, duplicatePath }) => `${formatPath(duplicatePath)} -> ${formatPath(firstPath)}`)
        .join(', ');
    const sMore = aRedundancies.length > 3 ? ` (+${aRedundancies.length -3} more)` : '';
    throw new TypeError(`${sLabel} contains redundant object references: ${sPreview}${sMore}`);
}

/**
 * Ráalkalmazza a diffDeep diff-listát az input állapotra, és visszaadja az új rootot.
 * Objektum/array rootnál helyben módosít, root-szintű `val` esetén új rootot ad vissza.
 * @param {any} target
 * @param {DiffEntry[]} aDiffs
 * @returns {any}
 */
function applyDiffs(target, aDiffs) {
    for (const [aPath, sType, xKey, value] of aDiffs) {
        if (sType === 'val' && xKey === undefined) {
            target = value;
            continue;
        }

        const oParent = getByPath(target, aPath);
        if (oParent === undefined)
            throw new TypeError(`applyDiffs: parent path not found: ${aPath.asPath()}`);

        if (sType === 'val' || sType === 'set') {
            oParent[xKey] = value;
            continue;
        }
        if (sType === 'rem') {
            delete oParent[xKey];
            continue;
        }
        if (!Array.isArray(oParent))
            throw new TypeError(`applyDiffs: ${sType} requires array parent at ${aPath.asPath()}`);
        if (sType === 'ins') {
            oParent.splice(xKey, 0, ...value);
            continue;
        }
        if (sType === 'del') {
            oParent.splice(xKey, value);
            continue;
        }

        throw new TypeError(`applyDiffs: unsupported diff type: ${sType}`);
    }

    return target;
}

export { JSONPath, mergeDeep, forceDeep, cleanDeep, mapDeep, setByPath, getByPath, equalDeep, findReferenceRedundancies, assertNoReferenceRedundancies, diffDeep, applyDiffs }