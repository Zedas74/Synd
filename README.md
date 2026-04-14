# HTML, SVG and SYND

## What are html\`\` and svg\`\` for?

A long-standing problem has been that producing HTML with events from JavaScript can only be done in two ways. Either we create the elements ourselves with DOM manipulation methods, or we use string-based HTML and add the events afterward:
```js
const msg = 'Alert!';

// Create a DOM button
const button = document.createElement('button');
button.className = 'demo-button';
button.textContent = 'Alert';
documement.body.append(button);

// Add the event
button.addEventListener('click', () =>
  input.value = alert(msg);
);
```
Or:
```js
const msg = 'Alert!';

// Create an HTML button
documement.body.innerHTML = '<button class="demo-button">Alert</button>';

// Add the event
const button = documement.body.querySelector('.demo-button');
button.addEventListener('click', () =>
  input.value = alert(msg);
);
```
Of course, there are simpler solutions, but they either have to be translated, or they are extremely cumbersome to use. HTML, on the other hand, offers a very simple way to mix HTML text and events:
```js
const msg = 'Alert!';
document.body.append(html`<button class="demo-button" onClick="${() => alert(msg)}">Alert</button>`);
```
Any event can be inserted this way; the important thing is that its name must start with `on` and an uppercase letter. So `onClick` inserts a `click` event.

Attributes and text content can also be inserted:
```js
const text = 'Alert', className = 'demo-button';
document.body.append(html`<button class="${className}">${text}</button>`);
```
The html\`\` function returns a DocumentFragment, which can be inserted.
```js
const text = 'Alert', className = 'demo-button';
document.body.append(html`<button class="${className}">${html`<b>${text}</b>`}</button>`);
```
It is also important that you do not mix static and dynamic pieces inside an attribute. This is bad:
```js
html`<button class="class_${name}"/>`
```
This is fine:
```js
html`<button class="${'class_' +name}"/>`
```

The DOM produced by the html\`\` function can have multiple roots:
```js
html`<i>A</i><b>B</b>`;
```
There are also attributes that are much better set after the children have been created. A good example is `value` on a select. It is applied during parsing before the `option`s exist, so it has no effect. Here, `psValue` means that the attribute is actually only written at the `</select>`, so the `select` is correctly set to the intended value.
```js
html`<select psValue="2">
  <option value="1">One</option>
  <option value="2">Two</option>
</select>`;
```

It is also useful to know that when you put a function inside html\`\`, it always receives the current parent DOM element:
```js
let div;
html`<div>${parent => div = parent}</div>`);
```
If the function returns something other than `null` or `undefined`, that value is inserted into the output.

The svg\`\` is another version of html\`\`, needed because SVG has its own special namespace.

## What is synd() for?

synd() is a data-synchronization solution related to html\`\`.

Here is a simple `synd` example:
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
`;
```

**What do we see here?**

synd() is a function that expects a `data` object, a `container` object, and a template function.

- `data` can be any JSON object, which means it cannot contain recursion, multiple references, and so on.
- `container` will hold the rendered template.
- Every template function has two parameters by default:
  - In the root template, `data` always matches the `data` object passed in as the argument.
  - `root` is a special object, whose `with` method we use in the example.

**What is `with` good for?**

`with` runs an inner template function on a part of `data` (in the example, the inner `.counter` object), and synd inserts it in place of the `with` call. In addition, it creates a live link between the data and the DOM in the background, so if we modify anything inside the part managed by `with` (at any depth), the part described by the template is refreshed in the DOM (**and only that part**).

In the example, pressing the button increments `data.counter.value`, and then we ask the whole synd instance to refresh itself. synd then figures out which template part inside the `with` is affected, and rebuilds only that part.

The `$` variable in the example is actually the same as `data` in `root`: it is the relevant part of the original JSON object, sliced out by the `.counter` path, which here is `{ value: 0 }`.

## `For` method

Here is a simple example of using `for`, where we can edit the values of a small table and increase the table size:

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
    <button onClick="${() => { data.grid.push(data.grid[0].map((_, i) => `${data.grid.length}.${i}`)); root.refresh(); }}">Add row</button>
    <button onClick="${() => { data.grid.forEach((a, i) => a.push(`${i}.${a.length}`)); root.refresh(); }}">Add col</button>
  </div>`);
```

**What do we see here?**

- `(_, root)` swallows the template data object; we do not need it, because we can access it through the original `data` variable.
- `root.for` works similarly to `root.with`, but the object addressed by the path must be an array, and the template is rendered for every array element.
- The inner `row.for` does not contain a path, because it uses the parent data directly (it would be equivalent to calling `row.for('', ($, cell) => … )`).
- The `cell.set` shorthand is actually equivalent to this: `e => cell.set(e)`, which is in fact this: `e => cell.set('', e)`. And that is equivalent to this: `e => set('', e.target.value)`.
- `set` really just writes the value back into the data and calls `synd.refresh()`. Obviously, if multiple fields change at once, that is not economical, and it is better to call `refresh()` separately, as you can also see with the buttons.
- synd makes it possible, for example, when adding columns, for the other rendered <td> elements not to change.

## Highlight in VSCode

The HTML code inside html\`\` is not highlighted automatically by VSCode, but there are extensions that can handle this, for example `es6-string-html`.
