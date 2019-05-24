import { assign } from './util';
import { diff, commitRoot } from './diff/index';
import options from './options';
import { Fragment, createElement } from './create-element';
import { diffChildren } from './diff/children';

/**
 * Base Component class. Provides `setState()` and `forceUpdate()`, which
 * trigger rendering
 * @param {object} props The initial component props
 * @param {object} context The initial context from parent components'
 * getChildContext
 */
export function Component(props, context) {
	this.props = props;
	this.context = context;
	// this.constructor // When component is functional component, this is reset to functional component
	// if (this.state==null) this.state = {};
	// this.state = {};
	// this._dirty = true;
	// this._renderCallbacks = []; // Only class components

	// Other properties that Component will have set later,
	// shown here as commented out for quick reference
	// this.base = null;
	// this._context = null;
	// this._ancestorComponent = null; // Always set right after instantiation
	// this._vnode = null;
	// this._nextState = null; // Only class components
	// this._prevVNode = null;
	// this._processingException = null; // Always read, set only when handling error
	// this._pendingError = null; // Always read, set only when handling error. This is used to indicate at diffTime to set _processingException
}

/**
 * Update component state and schedule a re-render.
 * @param {object | ((s: object, p: object) => object)} update A hash of state
 * properties to update with new values or a function that given the current
 * state and props returns a new partial state
 * @param {() => void} [callback] A function to be called once component state is
 * updated
 */
Component.prototype.setState = function(update, callback) {
	// only clone state when copying to nextState the first time.
	let s = (this._nextState!==this.state && this._nextState) || (this._nextState = assign({}, this.state));

	// if update() mutates state in-place, skip the copy:
	if (typeof update!=='function' || (update = update(s, this.props))) {
		assign(s, update);
	}

	// Skip update if updater function returned null
	if (update==null) return;

	if (this._vnode) {
		if (callback) this._renderCallbacks.push(callback);
		enqueueRender(this);
	}
};

/**
 * Immediately perform a synchronous re-render of the component
 * @param {() => void} [callback] A function to be called after component is
 * re-renderd
 */
Component.prototype.forceUpdate = function(callback) {
	let vnode = this._vnode, dom = this._vnode._dom, parentDom = this._parentDom;
	if (parentDom) {
		// Set render mode so that we can differantiate where the render request
		// is coming from. We need this because forceUpdate should never call
		// shouldComponentUpdate
		const force = callback!==false;

		let mounts = [];
		// dom = diff(parentDom, vnode, vnode, this._context, parentDom.ownerSVGElement!==undefined, null, mounts, this._ancestorComponent, force, dom, this._parentVNode);
		// if (dom!=null && dom.parentNode!==parentDom) {
		// 	// The component may be rendered somewhere in the middle of the parent's
		// 	// children. We need to find the nearest DOM sibling to insert our
		// 	// newly rendered node into.
		// 	let nextDom = getDomSibling(vnode);
		// 	if (nextDom==null || nextDom.parentNode!==parentDom) {
		// 		parentDom.appendChild(dom);
		// 	}
		// 	else {
		// 		parentDom.insertBefore(dom, nextDom);
		// 	}
		// }

		// TODO: Challenges
		// 	* diffChildren copies vnodes with _dom (by calling coerceToVNode), breaking the referential
		//		connection between this component's vnode and it's parent's _children array (or _prevVNode
		//		if parent is component)
		//	* Changing from `null` to `div` breaks cuz `vnode._dom` and therefore `oldDom` is null :'(. It needs
		//		to be the next dom sibling of this VNode
		const root = createElement(Fragment, {}, vnode);
		diffChildren(parentDom, root, root, this._context, parentDom.ownerSVGElement!==undefined, null, mounts, this._ancestorComponent, dom, force);

		commitRoot(mounts, vnode);
	}
	if (callback) callback();
};

/**
 * Accepts `props` and `state`, and returns a new Virtual DOM tree to build.
 * Virtual DOM is generally constructed via [JSX](http://jasonformat.com/wtf-is-jsx).
 * @param {object} props Props (eg: JSX attributes) received from parent
 * element/component
 * @param {object} state The component's current state
 * @param {object} context Context object, as returned by the nearest
 * ancestor's `getChildContext()`
 * @returns {import('./index').ComponentChildren | void}
 */
Component.prototype.render = Fragment;

/**
 * Get the nearest dom sibling
 * @param {import('./internal').VNode} vnode
 */
export function getDomSibling(vnode) {
	let item;
	let stack = [vnode];
	while (stack.length > 0) {
		if (item = stack.pop()) {

			// Bail out if vnode is a DOM node or has a `_dom` pointer
			if (typeof item.type=='string' && item._dom!==vnode._dom) {
				return item._dom;
			}

			let parent = item._parent;
			if (parent && typeof parent.type!=='string') {
				if (parent._sibling) {
					stack.push(item._parent._sibling);
				}
				else if (item._parent._parent && typeof item._parent._parent.type==='string') {
					stack.push(item._parent._parent);
				}
			}
			if (item._sibling) {
				stack.push(item._sibling);
			}

			let children = item._children || [item._component._prevVNode];
			if (item!==vnode && children) {
				stack.push(...children);
			}
		}
	}

	return null;
}

/**
 * The render queue
 * @type {Array<import('./internal').Component>}
 */
let q = [];

/**
 * Asynchronously schedule a callback
 * @type {(cb) => void}
 */
const defer = typeof Promise=='function' ? Promise.prototype.then.bind(Promise.resolve()) : setTimeout;

/*
 * The value of `Component.debounce` must asynchronously invoke the passed in callback. It is
 * important that contributors to Preact can consistenly reason about what calls to `setState`, etc.
 * do, and when their effects will be applied. See the links below for some further reading on designing
 * asynchronous APIs.
 * * [Designing APIs for Asynchrony](https://blog.izs.me/2013/08/designing-apis-for-asynchrony)
 * * [Callbacks synchronous and asynchronous](https://blog.ometer.com/2011/07/24/callbacks-synchronous-and-asynchronous/)
 */

/**
 * Enqueue a rerender of a component
 * @param {import('./internal').Component} c The component to rerender
 */
export function enqueueRender(c) {
	if (!c._dirty && (c._dirty = true) && q.push(c) === 1) {
		(options.debounceRendering || defer)(process);
	}
}

/** Flush the render queue by rerendering all queued components */
function process() {
	let p;
	q.sort((a, b) => b._depth - a._depth);
	while ((p=q.pop())) {
		// forceUpdate's callback argument is reused here to indicate a non-forced update.
		if (p._dirty) p.forceUpdate(false);
	}
}
