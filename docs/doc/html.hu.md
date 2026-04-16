# HTML és SYND

A synd() függvény és a html\`\` template string azért születtek, hogy megkönnyítsék és leegyszerűsítsék az adat alapú HTML oldalak renderelését a böngészőkben.

(Ha nem tudod mi az a template string, [itt a leírás](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Template_literals))

## Hogyan tudom használni?

Egyszerűen töltsd le a [deploy/synd.mjs](https://github.com/Zedas74/Synd/blob/main/deploy/synd.mjs)-t (csak 19KB), majd importáld egy tetszőleges oldalra:

```html
<!DOCTYPE html>
<html>
<head>
  <script type="module">

    import { html, synd } from './js/synd.mjs';
    …

  </script>
  </head>
  <body>
  </body>
</html>
```

## Jó, de mire is való pontosan a html\`\`?

Régi probléma, hogy JavaScriptből eventekkel ellátott DOM-ot előállítani csak kétféle módon lehet: vagy mi hozzuk létre az elemeket, DOM manipuláló metódusokkal, vagy string alapú HTML-t használunk, és utólag adjuk hozzá az eventeket (a klasszikus "onclick" és hasonló eventektől most tekintsünk el, mert azokkal számtalan probléma van, és senki sem javasolja a használatukat).

**A DOM kreáció nagyjából így néz ki:**
```js
const msg = 'Alert!';

// DOM gomb létrehozása
const button = document.createElement('button');
button.className = 'demo-button';
button.textContent = 'Alert';
document.body.append(button);

// Event hozzáadása
button.addEventListener('click', () =>
  input.value = alert(msg);
);
```
**A stringes pedig így:**
```js
const msg = 'Alert!';

// HTML gomb létrehozása
document.body.innerHTML = '<button class="demo-button">Alert</button>';

// Event hozzáadása
const button = document.body.querySelector('.demo-button');
button.addEventListener('click', () =>
  input.value = alert(msg);
);
```
Léteznek persze egyszerűbb megoldások, de ezeket vagy le kell fordítani, vagy borzasztó körülményes a használatuk. 

**A html\`\` ezekkel szemben egy rendkívül egyszerű, gyors és runtime használható módot kínál a html szöveg és eventek keverésére:**
```js
const msg = 'Alert!';
document.body.append(html`<button class="demo-button" onClick="${() => alert(msg)}">Alert</button>`);
```
Bármilyen eventet be lehet így szúrni, a lényeg, hogy 'on'-nal és nagybetűvel kell kezdődni a nevüknek. Tehát az `onClick` egy `click` eventet szúr be.

Nyilván attribútumokat és szöveges tartalmat is be lehet szúrni:
```js
const text = 'Alert', className = 'demo-button';
document.body.append(html`<button class="${className}">${text}</button>`);
```
A html\`\` DocumentFragment-et ad vissza, amely beszúrható, tehát a hasonló elemek egymásba ágyazhatók:
```js
const text = 'Alert', className = 'demo-button';
document.body.append(html`<button class="${className}">${html`<b>${text}</b>`}</button>`);
```
Fontos, hogy az attribútumokban nem szabad statikus és dinamikus elemeket keverni, tehát ez rossz:
```js
html`<button class="class_${name}"/>`
```
Ez viszont már jó:
```js
html`<button class="${'class_' +name}"/>`
```

A html\`\` függvény által előállított DOM-nak több gyökere is lehet:
```js
html`<i>A</i><b>B</b>`;
```
Lehetnek olyan attribútumok, amelyeket sokkal jobb a gyermekek létrehozása után beállítani, ilyen például a selectnél a `value`. Ez normál esetben előbb állítódik be HTML parszoláskor, mint ahogy az `option`-ok létrejönnének, ezért nincs hatása. Itt viszont a `psValue` azt csinálja, hogy az attribútum valójában csak a `</select>`-nél íródik be, így a `select` jól beáll a megfelelő értékre.
```js
html`<select psValue="2">
  <option value="1">One</option>
  <option value="2">Two</option>
</select>`;
```

Azt is érdemes tudni, hogy amennyiben a html\`\` kód részébe függvényt rakunk, az mindig megkapja az éppen aktuális szülő DOM elemet:
```js
let div;
html`<div>${parent => div = parent}</div>`);
```
Amúgy ilyenkor ha a függvény visszatérési értéke nem `null` vagy `undefined`, akkor az kerül be az outputba.

A html\`\` elfogad érték nélküli attribútumokat is (pl. `selected`), és HTML kommenteket is.

A html\`\`-nek létezik egy alternatív verziója is (ugyanonnan importálható): az **svg\`\`**. Ez ugyanazt tudja, de minden elemhez az SVG namespace-t használja.

## Mire való a synd()?

A synd() a html\`\`-hez kapcsolódó, adatszinkront biztosító megoldás.

Itt egy egyszerű `synd` példa:
```js
control = synd({ data: { counter: { value: 0 } }, container: document.body }, (data, root) => html`
  <article class="counter-box">
    <label>synd</label>
    <div class="button-row">${
      root.with('.counter', $ => html`
        <input class="demo-input" type="number" value="${$.value}"/>
      `)}
      <button class="demo-button" onClick="${() => {
        data.counter.value += 1;
        root.refresh();
      }}">+1</button>
    </div>
  </article>
```

**Mit látunk itt?**

A synd() egy függvény, amely egy `data` és egy `container` objektumot, valamint egy template függvényt vár.

- A `data` tetszőleges JSON objektum lehet, ami azt jelenti, hogy nem lehetnek benne rekurziók, többszörös hivatkozások, stb.
- A `container` tartalmazza majd a kirenderelt template-et.
- Minden template függvény alapból két paraméterrel rendelkezik:
  - A `data` a gyökér template-ben mindig megegyezik a paraméterként adott `data` objektummal.
  - A `root` egy speciális objektum, aminek a példában a `with` metódusát használjuk.

**Mire jó a `with`?**

A `with` a `data` egy részére (a példában a `.counter` belső objektumról van szó) futtat egy belső template függvényt, amit a with helyére illeszt be a synd. Emellett a háttérben létrehoz egy élő linket az adat és a DOM között, így ha az adat `with` által felügyelt részén belül módosítunk valamit (akármilyen mélyen), akkor a template által leírt rész (**és csak az**) frissül a DOM-ban.

A példában a gomb megnyomásával a `data.counter.value` mező értékét növeljük, majd megkérjük az egész synd-et, hogy frissítse magát. A synd ezután kitalálja, hogy melyik `with`-en belüli template rész érintett, és csak azt a részt építi újra.

A mintában látható `$` változó valójában ugyanaz, mint a `root`-nál a `data`: az alap JSON objektum érintett (a '.counter' ösvény által kivágott) része, ami itt `{ value: 0 }`.

## `For` metódus

Itt egy egyszerű példa a `for` használatára, amelyben egy apró táblázat értékeit módosíthatjuk, és növelhetjük a táblázat méretét:

```js
const data = {
	grid: [
		['0.0', '0.1'],
		['1.0', '1.1'],
	]
}

const oPage = synd({ data, container: document.body }, (_, root) => html`
  <div>
    <table>${
      root.for('.grid', (_, row) => html`<tr>${
        row.for(($, cell) => html`<td><input style="background:transparent; color: inherit; border: none" 
          value="${$}" onChange="${cell.set}"/></td>`)
      }</tr>`)
    }</table><br/>
    <button onClick="${() => { 
      data.grid.push(data.grid[0].map((_, i) => `${data.grid.length}.${i}`)); 
      root.refresh(); 
    }}">Add row</button>
    <button onClick="${() => { 
      data.grid.forEach((a, i) => a.push(`${i}.${a.length}`));
      root.refresh(); 
    }}">Add col</button>
  </div>`);
```

**Mit látunk itt?**

- A `(_, root)` lenyeli a template data objektumát, nincs rá szükségünk, mivel azt elérjük az eredeti `data` változón keresztül.
- A `root.for` a `root.with`-hez hasonlóan működik, de az ösvénnyel címzett objektumnak tömbnek kell lennie, és a template minden tömb elemre kirenderelődik.
- A belső `row.for` nem tartalmaz ösvényt, mert közvetlenül a szülő adatait használja (egyenértékű lenne a `row.for('', ($, cell) => … )` hívással).
- A `cell.set` shorthand valójában egyenértékű ezzel: `e => cell.set(e)`, ami valójában ez: `e => cell.set('', e)`. Ez pedig egyenértékű ezzel: `e => set('', e.target.value)`.
- A `set` valójában annyit csinál, hogy visszaírja a datába az értéket, és meghívja a `synd.refresh()`-t. Nyilván, ha egyszerre több mező változik, akkor ez nem gazdaságos, és inkább külön kell meghívni a `refresh()` metódust, mint az a gomboknál láthatjuk is.
- A synd lehetővé teszi, hogy pl. az oszlopok hozzáadásakor a többi kirenderelt <td> elem ne változzon.

## Highlight a VSCode-ban

A html\`\`-ben található HTML kódot a VSCode nem színezi be magától, ám léteznek olyan kiterjesztések, amelyek ezt megoldják, például a `es6-string-html`.