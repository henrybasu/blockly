/**
 * @fileoverview The class for generating accessible linearization
 * of a workspace, and a helper classes
 */

 goog.provide('Blockly.Linearization');
 goog.provide('Blockly.Linearization.BlockJoiner');

 goog.require('Blockly.ASTNode');
 goog.require('Blockly.Block');
 goog.require('Blockly.Connection');
 goog.require('Blockly.Events');
 goog.require('Blockly.FieldDropdown');
 goog.require('Blockly.FieldNumber');
 goog.require('Blockly.FieldTextInput');

/**
 * Class for generating the linearization of a workspace, displayed in parent
 * nav and mainNavList.
 *
 * @constructor
 * @param {!Blockly.Workspace} workspace the main workspace to represent
 * @param {!HTMLElement} parentNav the element to display the parent
 * breadcrumbs within
 * @param {!HTMLElement} mainNavList the element to display the main
 * linearization of workspace within
 */
Blockly.Linearization = function(workspace, parentNav, mainNavList) {
  /** @const */
  this.workspace = workspace;

  /** @const */
  this.blockJoiner = new Blockly.Linearization.BlockJoiner();

  /**
   * The element to generate parent nav in.
   * @type {HTMLElement}
   */
  this.parentNav = parentNav;

  /**
   * The element to generate the main linearization in.
   * @type {HTMLElement}
   */
  this.mainNavList = mainNavList;

  /**
   * Override existing style with default linearization css.
   * @type {boolean}
   */
  this.enforceDefaultCss = true;

  /**
   * The key used to determine whether or not to call this.generateList_.
   * @type {Object}
   * @private
   */
  this.pendingRenderEvent_ = null;

  /**
   * The cooldown for changing this.selected in response to workspace events
   * @type {number}
   * @private
   */
  this.cooldown_ = 0;

  /**
   * The font size to generate in
   * @type {number}
   * @private
   */
  this.fontSize_ = 14;

  /**
   * The number of pixels wide to generate indents in this.mainNavList.
   * @type {number}
   * @private
   */
  this.indentPixels_ = 8;

  // ***Requires Localization***
  /** @const @private */
  this.blankText_ = 'NOTHING';

  // ***Requires Localization***
  /** @const @private */
  this.returnText_ = 'return ';

  workspace.addChangeListener(e => this.onChange(e));
};

/**
 * A class to manage in-progress connections in Blockly.Linearization.
 * Pushing a block and a connection node will automatically attempt to connect
 *  the two objects and return a boolean representing the success or failure
 * of pushing an object. While most failures to connect are silent, attempting
 * to generate a circular DOM will crash the tab and force reload.
 *
 * Note that sucessful pushing to this does not necessitate successful moving,
 * in fact, the first time push is called will return true if the type of the
 * parameter is correct, but can never successfully move (since there is no-
 * -where/-thing to move/connect to).
 * @constructor
 */
Blockly.Linearization.BlockJoiner = function() {
  /**
   * The block to move
   * @type {Blockly.ASTNode}
   */
  this.blockNode = null;

  /**
   * The connection to attach to
   * @type {Blockly.ASTNode}
   */
  this.connectionNode = null;
};

/**
 * Attempt to connect this item.
 * item.getLocation() must be Blockly.Block or Blockly.Connection.
 * @param {!Blockly.ASTNode} item
 * @return {boolean} true if successfully pushed, false if push fails. Note:
 * a push can be successful without moving the block/connecting the connection
 */
Blockly.Linearization.BlockJoiner.prototype.push = function(item) {
  if (item.getLocation() instanceof Blockly.Block) {
    this.blockNode = item;
  } else if (item.getLocation() instanceof Blockly.Connection) {
    this.connectionNode = item;
  } else {
    console.warn('fell through push types', item);
    return false;
  }

  // will always fail to connect the first time something is pushed, however
  // if this point is reached, will return true representing successful push
  this.attemptConnection_();
  return true;
};

/**
 * Attempt to pair blockNode and connectionNode. If successful, join the
 * connections. Either way, nullify this.blockNode and this.connectionNode.
 * @private
 */
Blockly.Linearization.BlockJoiner.prototype.attemptConnection_ = function() {
  if (!this.blockNode || !this.connectionNode) {
    return;
  }

  var advance, back;
  // define advance and back by the AST direction the connection node points
  switch (this.connectionNode.getType()) {
    case Blockly.ASTNode.types.NEXT:
    // fall through, same behavior
    case Blockly.ASTNode.types.INPUT:
      advance = n => n.next();
      back = n => n.prev();
      break;
    case Blockly.ASTNode.types.PREVIOUS:
    // fall through, same behavior
    case Blockly.ASTNode.types.OUTPUT:
      advance = n => n.prev();
      back = n => n.next();
      break;
    default:
      console.warn('fell through advance/back assignment', this.connectionNode);
      return;
  }

  var provided = this.blockNode;
  var providedBlock = back(provided).getLocation();

  // disconnect any old connections
  try {
    var detach = [Blockly.ASTNode.types.PREVIOUS, Blockly.ASTNode.types.OUTPUT];
    var hasPrevPrevNode = provided.prev() && provided.prev().prev();
    if (hasPrevPrevNode && detach.includes(provided.prev().getType())) {
      provided.prev().getLocation().disconnect();
      provided.prev().getLocation().bumpNeighbours_();
    }
  } catch (e) { /* unsuccessful disconnect or bump */  }

  // connect this.blockNode and this.connectionNode, if right connectionNode
  // provided (node.next()), Blockly should automatically reconnect any children
  try {
    this.connectionNode.getLocation().connect(providedBlock);
  } catch (e) {
    console.warn(e);
    if (e instanceof DOMException) { // should never happen
      // If the code reaches this point, the user attempted to connect
      // a block to one of its move children (see getMoveParentBlocks_),
      // creating a circular DOM, the only exit without freezing the tab is
      // to force a reload

      // If this happens again, g-d save us all.
      document.location.reload();
    }
  }

  // clear the values
  this.connectionNode = null;
  this.blockNode = null;
};

/**
 * Attempts to disconnect the current block in this.blockNode and put in on the
 * workspace. Nulls this.blockNode if successful.
 */
Blockly.Linearization.BlockJoiner.prototype.disconnectBlock = function() {
  try {
    this.blockNode.prev().getLocation().disconnect();
    this.blockNode.getLocation().bumpNeighbours_();
    this.blockNode = null;
  } catch (e) { /* unsuccessful disconnect/bump */ }
};

/**
 * The ChangeListener for workspace events. On fire, creates a promise to fully
 * redraw linearization if another request is not recieved in 100 millis.
 * @param {?Blockly.Events.Abstract} e the workspace event that triggers this
 * ChangeListener.
 */
Blockly.Linearization.prototype.onChange = function(e) {
  // if throttling is occuring, the generation of promises for each event may
  // be the cause. This format garuntees that a chain of events each within
  // 100 millis of each other will be ignored until the final event. As such,
  // it handles stress testing and importing very well with a slight drop in
  // standard performance. Other configurations may be tested at user's risk
  this.pendingRenderEvent_ = e;

  new Promise((resolve, reject) => {
    setTimeout(() => {
      if (this.pendingRenderEvent_ === e) {
        this.pendingRenderEvent_ = null;
        this.generateList_(e);
        resolve(e);
      } else {
        reject('skipped render');
      }
    }, 100);
  }).catch(console.warn);
};

/**
 * Fully redraws linearization, replacing the mainNavList and parentNav.
 * @param {?Blockly.Events.Abstract} e the workspace event that triggers this
 * @private
 */
Blockly.Linearization.prototype.generateList_ = function(e) {
  if (!this.workspace.getAllBlocks().length) {
    // ***Requires Localization***
    this.parentNav.innerHTML = '(empty workspace)';
    this.mainNavList.innerHTML = '';
    return;
  }

  if (e) {
    // change this.selected with e
    this.alterSelectedWithEvent_(e);
  }

  // make and replace the parentNav
  this.generateParentNav_(this.selected);

  // make proper view...
  var navListDiv = this.mainNavList;
  var newDiv = this.selected?
      this.makeBlockSpecificView_(this.selected):
      this.makeWorkspaceView_();

  // ...and replace mainNavList
  newDiv.setAttribute('id', 'mainNavList');
  navListDiv.parentNode.replaceChild(newDiv, navListDiv);
  this.mainNavList = newDiv;

  if (this.enforceDefaultCss) {
    this.applyNavStyle_();
  }
};

/**
 * Applies the indent and bulleting scheme to the mainNavList
 * @private
 */
Blockly.Linearization.prototype.applyNavStyle_ = function() {
    var children = [...this.mainNavList.getElementsByTagName('*')]
        .filter(child => child.tagName !== 'SPAN');

  children.forEach(child => child.style['list-style-type'] = 'none');

  var padding = this.indentPixels_ + 'px';
  children.forEach(child => child.style['padding-inline-start'] = padding);
};

/**
 * Uses the type of the event e to determine the next this.selected.
 * @param {!Blockly.Events.Abstract} e the workspace event that determines the
 * next selected
 * @private
 */
Blockly.Linearization.prototype.alterSelectedWithEvent_ = function(e) {
  this.cooldown_ = this.cooldown_ && this.cooldown_ < new Date().getTime();

  var node;
  switch (e.type) {
    case Blockly.Events.BLOCK_MOVE:
      if (this.cooldown_) {
        console.warn('event skipped');
        return;
      }
      var block = this.workspace.getBlockById(e.blockId);
      node = block && Blockly.ASTNode.createBlockNode(block);
      break;
    case Blockly.Events.BLOCK_CREATE:
      var block = this.workspace.getBlockById(e.blockId);
      node = block && Blockly.ASTNode.createBlockNode(block);
      if (node) {
        this.startEventCooldown_();
      }
      break;
    case Blockly.Events.UI:
      if (e.element !== 'selected' && e.element !== 'click') {
        node = this.selected;
      } else if (!e.blockId) {
        node = null;
      } else {
        var block = this.workspace.getBlockById(e.blockId);
        node = Blockly.ASTNode.createBlockNode(block);
      }
      break;
    case Blockly.Events.BLOCK_DELETE:
    // fall through, same behavior
    case Blockly.Events.FINISHED_LOADING:
      node = null;
      break;
  }

  this.listItemOnclick_(node);
};

/**
 * Sets this.cooldown_ to 100 millis
 * @private
 */
Blockly.Linearization.prototype.startEventCooldown_ = function() {
  this.cooldown_ = new Date().getTime() + 100;
};

/**
 * Generates and replaces the old parent-nav bar, using color-coded, linked
 * breadcrumbs. Always includes this.workspace.
 * @param {?Blockly.ASTNode} rootNode Generates breadcrumbs from rootNode's
 * parentStack down to and including rootNode.
 * @private
 */
Blockly.Linearization.prototype.generateParentNav_ = function(rootNode) {
  var pNav = this.parentNav;
  pNav.innerHTML = '';
  pNav.appendChild(this.makeParentItem_());

  if (rootNode) {
    rootNode.ancestors(true).reverse()
        .filter(node => node.getType() === Blockly.ASTNode.types.BLOCK)
        .map(node => this.makeParentItem_(node))
        .forEach(elem => pNav.appendChild(elem));
  }

  // add movement options...
  // ...cancel move item...
  var blockNode = this.blockJoiner.blockNode;
  if (this.blockJoiner.connectionNode || blockNode) {
    pNav.appendChild(this.createElement('br'));
    var cancelItem = this.createElement('b');
    // ***Requires Localization***
    cancelItem.appendChild(document.createTextNode('Cancel Move'));
    cancelItem.addEventListener('click', e => {
        if (this.blockJoiner.connectionNode) {
          this.blockJoiner.connectionNode = null;
        } else {
          this.blockJoiner.blockNode = null;
        }
        this.generateList_();
    });
    pNav.appendChild(cancelItem);
  }

  // ...delete block item...
  if (blockNode && !this.selected) {
    pNav.appendChild(this.createElement('br'));
    var deleteItem = this.createElement('b');
    // ***Requires Localization***
    var text = 'Delete me';
    deleteItem.appendChild(document.createTextNode(text));
    deleteItem.addEventListener('click', e => {
      this.blockJoiner.blockNode = null;
      blockNode.getLocation().dispose(true);
    })

    // ...make into new stack item...
    if (blockNode.prev()) {
      // if this has the ability to be mid-stack (unlike hat blocks)
      pNav.appendChild(deleteItem);
      pNav.appendChild(this.createElement('br'));
      var newStackItem = this.createElement('b');
      // ***Requires Localization***
      newStackItem.appendChild(document.createTextNode('Start new stack'));
      newStackItem.addEventListener('click', e => {
        this.blockJoiner.disconnectBlock();
      });
      pNav.appendChild(newStackItem);
    }

    // ...duplicate block item
    var duplicateItem = this.makeDuplicateItem_(this.blockJoiner.blockNode);
    if (duplicateItem) {
      pNav.appendChild(this.createElement('br'));
      pNav.appendChild(duplicateItem);
    }
  }
};

/**
 * Creates and returns the HTML unordered list of labelled stacks with sublists
 * of every block on the same visual indent, represented with list elements
 * @return {HTMLElement} an html unordered list of the top level of the current
 * workspace.
 * @private
 */
Blockly.Linearization.prototype.makeWorkspaceView_ = function() {
  var workspace = this.workspace;
  var wsNode = Blockly.ASTNode.createWorkspaceNode(workspace);
  var list = this.createElement('ul');

  var firstStack = wsNode.in();
  var stacks = firstStack.collect(n => n.next());

  // this.makeStackItem_ requires that this.marker be intialized
  this.marker = 'A';
  stacks.map(stack => this.makeStackItem_(stack)).forEach(n => list.append(n));

  return list;
};

/**
 * Generates the html li that contains listings for all items in the stack,
 * requires that this.marker be set to the stack marker for this stack, and will
 * automatically advance that marker using Blockly.Linearization;
 * @param {!Blockly.ASTNode} stackNode the stack to represent
 * @return {HTMLElement} a list element describing the complete stack as
 * a color-coded, linked sublist
 */
Blockly.Linearization.prototype.makeStackItem_ = function(stackNode) {
  var stackItem = this.createElement('li');
  // ***Requires Localization***
  var stackElem = this.makeTextItem('Stack ' + this.marker);
  this.marker = Blockly.Linearization.nextStackMarker(this.marker);

  stackItem.appendChild(stackElem);
  var stackItemList = this.createElement('ul');

  // first block in stack
  var blockNode = stackNode.in();
  if (blockNode.getType() !== Blockly.ASTNode.types.BLOCK) {
    blockNode = blockNode.nextBlock();
  }

  var rootBlock = blockNode.getLocation();
  blockNode.collect(n => n.nextBlock())
    .map(node => this.makeBlockList_(node, rootBlock))
    .forEach(items => stackItemList.append(...items));

  stackItem.appendChild(stackItemList);
  return stackItem;
};

/**
 * Takes in a block node and recursively makes the list of elements for all
 * descendant blocks.
 * Excludes inline blocks, such as those found in the repeat x times block.
 * @param {Blockly.ASTNode} node the block AST node to start from
 * @param {Blockly.Block} rootBlock the block at which node points to
 * @return {Array<HTMLElement>} an array containing all elements for descendants
 * @private
 */
Blockly.Linearization.prototype.makeBlockList_ = function(node, rootBlock) {
  var block = node.getLocation();
  var nestedName = Blockly.Linearization.getNestingBlockName(block);
  // ***Requires Localization***
  var endLabel = nestedName && this.makeTextItem('end ' + nestedName);
  if (endLabel) {
    // ***Requires Localization***
  	endLabel.firstChild.setAttribute('role', 'text');
  }

  if (node.getType() !== Blockly.ASTNode.types.BLOCK
    || (block.outputConnection && block.getParent())
    || block.getRootBlock() !== rootBlock) {
    return endLabel? [endLabel]: [];
  }

  // recursively generates a ul containing all html representations of children
  const generateInnerBody = (node) => {
    var nestedItemList = this.createElement('ul');
    node.collect(n => n.nextBlock())
        .map(node => this.makeBlockList_(node, rootBlock))
        .forEach(items => nestedItemList.append(...items));
    return nestedItemList;
  }

  const alterAriaLabel = (item) => {
    var parent = block.getSurroundParent();
    if (parent) {
      var nestingName = Blockly.Linearization.getNestingBlockName(parent);
      // ***Requires Localization***
      var text = item.firstChild.textContent + ', inside ' + nestingName;
      item.firstChild.setAttribute('aria-label', text);
    }
    item.firstChild.setAttribute('role', 'button');
  }

  var basicNodeItems = this.makeNodeItems_(node);
  var descendantItems = [];

  if (basicNodeItems.first) {
    descendantItems.push(basicNodeItems.first);
  }

  if (block.type === 'controls_if') {
    var branches = Blockly.Linearization.getIfBranches(node);
    for (var branch of branches) {
      var headerItem = this.makeIfBracketItem_(node, branch);
      alterAriaLabel(headerItem);
      descendantItems.push(headerItem);

      var body = this.createElement('ul');
      if (branch.bodyNode) {
        body = generateInnerBody(branch.bodyNode);
      } else if (this.blockJoiner.blockNode) {
        var bodyNode =
            Blockly.ASTNode.createConnectionNode(branch.bodyConnection);
        if (Blockly.Linearization.checkConnection(bodyNode, this.blockJoiner.blockNode)) {
          var text = 'Insert within ' + branch.text;
          body.appendChild(this.makeConnectionItem_(bodyNode, text));
        }
      }
      descendantItems.push(body);
    }
  } else {
    var mainElem = basicNodeItems.main;
    alterAriaLabel(mainElem);
    descendantItems.push(mainElem);

    var firstNested = node.inBlock();
    if (firstNested) {
      var body = generateInnerBody(firstNested);

      if (block.type === 'procedures_defreturn') {
        var endIndex = mainElem.innerHTML.lastIndexOf(this.returnText_);
        mainElem.innerHTML = mainElem.innerHTML.slice(0, endIndex);
        body.append(this.makeReturnItem_(node));
      }

      descendantItems.push(body);
    } else if (this.blockJoiner.blockNode && node.in()) {
      var body = this.createElement('ul');
      body.append(...this.makeInnerInputList_(node));
      descendantItems.push(body);
    }
  }

  if (endLabel) {
    descendantItems.push(endLabel);
  }

  if (basicNodeItems.final) {
    descendantItems.push(basicNodeItems.final);
  }

  return descendantItems;
};

/**
 * Creates and returns the HTML unordered list of every block on the same visual
 * indent within the rootNode, represented with list elements
 * @param {!Blockly.ASTNode} rootNode the direct parent of all items in the list
 * @return {HTMLElement} an html unordered list of the top level of the rootNode
 * @private
 */
Blockly.Linearization.prototype.makeBlockSpecificView_ = function(rootNode) {
  var sublist = this.createElement('ul');
  sublist.appendChild(this.makeGoBackItem_(rootNode));

  var showOnBranch = !this.selected.branch || !this.selected.branch.key;
  if (showOnBranch && !rootNode.getLocation().isShadow()) {
    sublist.appendChild(this.makeMoveItem_(rootNode));
  }

  var warning = rootNode.getLocation().warning;
  if (warning && warning.getText && warning.getText().trim().length) {
    var warnItem = this.makeTextItem(warning.getText());
    warnItem.style.color = 'rgb(250, 50, 50)';
    sublist.appendChild(warnItem);
  }

  var isIfNode = rootNode.getLocation().type === 'controls_if';

  var inline = rootNode.in()
  if (!inline || inline.getType() === Blockly.ASTNode.types.PREVIOUS) {
    inline = null;
  }

  if (inline && !isIfNode) {
    inline.collect(Blockly.Linearization.nextInlineInput)
      .map(node => this.makeInputItem_(node))
      .filter(Boolean)
      .forEach(elem => sublist.appendChild(elem));
  }

  if (rootNode.getLocation().mutator && (!isIfNode || showOnBranch)) {
    sublist.append(...this.makeMutatorList_(rootNode));
  }

  var firstNested = rootNode.inBlock();

  if (isIfNode) {
    sublist.append(...this.makeIfList_(rootNode));
  } else if (firstNested) {
    firstNested.collect(n => n.nextBlock())
        .map(node => this.makeNodeItems_(node))
        .forEach(elems => sublist.append(...elems));
  } else if (!this.blockJoiner.connectionNode) {
    sublist.append(...this.makeInnerInputList_(rootNode));
  }

  if (rootNode.getLocation().type === 'procedures_defreturn') {
    sublist.appendChild(this.makeReturnItem_(rootNode));
  }

  return sublist;
};

/**
 * Returns an ordered Array of linked html list items that represent the
 * movement options of the node and the node itself
 * @param {!Blockly.ASTNode} node the node to represent
 * @return {Array<HTMLElement>} an array containing the html representation of
 * node and its options
 * @private
 */
Blockly.Linearization.prototype.makeNodeItems_ = function(node) {
  var list = [];

  var prevConnectionItem = this.makePrevConnectionItem_(node);
  if (prevConnectionItem) {
    list.push(prevConnectionItem);
    list.first = prevConnectionItem;
  }

  var main = this.makeBlockItem_(node);
  list.push(main);
  list.main = main;

  var nextConnectionItem = this.makeNextConnectionItem_(node);
  if (nextConnectionItem) {
    list.push(nextConnectionItem);
    list.final = nextConnectionItem;
  }

  return list;
};

/**
 * Generates the html item that pushes the previous connection when
 * this.blockJoiner.blockNode is not null and the node is the first child in a
 * list
 * @param {!Blockly.ASTNode} node the node where node.prev() is called
 * @return {HTMLElement} a list element describing that pushes node.prev() to
 * this.blockJoiner when possible, null otherwise
 */
Blockly.Linearization.prototype.makePrevConnectionItem_ = function(node) {
  var blockNode = this.blockJoiner.blockNode;
  var display = blockNode !== node && blockNode;
  var prevConn = node.prev();
  var displayPrev = prevConn && (!prevConn.prev() ||
      prevConn.prev().getType() !== Blockly.ASTNode.types.NEXT);
  if (display && prevConn && displayPrev &&
      Blockly.Linearization.checkConnection(prevConn, blockNode.next())) {
    // ***Requires Localization***
    if (prevConn.prev() &&
        prevConn.prev().getType() === Blockly.ASTNode.types.INPUT) {
      return this.makeConnectionItem_(prevConn.prev(), 'Insert above');
    }
    return this.makeConnectionItem_(prevConn, 'Insert above');
  }
  return null;
};

/**
 * Generates the html item that pushes the next connection to this.blockJoiner
 * when this.blockJoiner.blockNode is not null
 * @param {!Blockly.ASTNode} node the node where node.next() is called
 * @return {HTMLElement} a list element describing that pushes node.next() to
 * this.blockJoiner when possible, null otherwise
 */
Blockly.Linearization.prototype.makeNextConnectionItem_ = function(node) {
  var blockNode = this.blockJoiner.blockNode;
  var display = blockNode !== node && blockNode;
  var nextConn = node.next();
  if (display && nextConn &&
      Blockly.Linearization.checkConnection(nextConn, blockNode.prev())) {
    var last = !nextConn.next() ||
        nextConn.next().getType() !== Blockly.ASTNode.types.PREVIOUS;
        // ***Requires Localization***
    var text = last? 'Insert below': 'Insert between';
    return this.makeConnectionItem_(node.next(), text);
  }
  return null;
};

/**
 * Returns all inner input nodes as a array of html elements
 * @param {!Blockly.ASTNode} rootNode the element to get inner inputs for
 * @return {Array<HTMLElement>} an array containing all inner input elements
 * encoded as html list items
 * @private
 */
Blockly.Linearization.prototype.makeInnerInputList_ = function(rootNode) {
  var blockNode = this.blockJoiner.blockNode;
  if (!blockNode) {
    return [];
  }

  var inNodeSeq = rootNode.in().collect(n => n.next());
  const parentInputType = (n) => n.getParentInput() && n.getParentInput().type;
  const hasInputParent = (n) => parentInputType(n) === Blockly.INPUT_VALUE;

  var inlines = inNodeSeq.filter(hasInputParent).length;
  var withins = inNodeSeq.length - inlines;

  var tracker = {
    tackVal: 1,
    insertVal: 1,
    tackText: function() {
      return inlines <= 1? '': ' ' + tracker.tackVal++;
    },
    insertText: function() {
      return withins <= 1? '': ' ' + tracker.insertVal++;
    }
  }

  return inNodeSeq
      .filter(n => this.selected || !hasInputParent(n))
      .filter(n => Blockly.Linearization.checkConnection(n, blockNode.prev()))
      .map(n => this.makeConnectionItem_(n,
            hasInputParent(n)?
                // ***Requires Localization***
                'Tack on side' + tracker.tackText():
                // ***Requires Localization***
                'Insert within' + tracker.insertText())
          );
};

/**
 * Returns all mutator options for the block rootNode wraps in an array.
 * @param {!Blockly.ASTNode} node node containing the block with mutator
 * @return {Array<HTMLElement>} an array containing all mutator options encoded
 * as html list items.
 * @private
 */
Blockly.Linearization.prototype.makeMutatorList_ = function(node) {
  var block = node.getLocation();
  var list = [];

  const alterAttr = (attrStr, fn) =>
    function(obj) {
      // null when no mutations (ie basic if block)
      var mutXml = obj.mutationToDom() || document.createElement('mutation');
      var old = parseInt(mutXml.getAttribute(attrStr), 10) || 0;
      mutXml.setAttribute(attrStr, fn(old));
      obj.domToMutation(mutXml);
    };

  const incrAttr = (attrStr) => alterAttr(attrStr, n => n + 1);
  const decrAttr = (attrStr) => alterAttr(attrStr, n => n - 1);

  if (block.elseifCount_ != undefined) {
    // ***Requires Localization***
    list.push(this.makeMutatorItem_(node, 'Add elseif', incrAttr('elseif')));

    if (block.elseifCount_ > 0) {
      // ***Requires Localization***
      list.push(this.makeMutatorItem_(node, 'Remove elseif', decrAttr('elseif')));
    }
  }

  if (block.elseCount_ === 0) {
    // ***Requires Localization***
    list.push(this.makeMutatorItem_(node, 'Add else', incrAttr('else')));
  } else if (block.elseCount_ === 1) {
    // ***Requires Localization***
    list.push(this.makeMutatorItem_(node, 'Remove else', block => {
      var elseBranch = Blockly.Linearization.getIfBranches(node).pop();
      if (elseBranch && elseBranch.bodyConnection
          && elseBranch.bodyConnection.targetConnection) {
        elseBranch.bodyConnection.disconnect();
      }
      decrAttr('else')(block);
    }));
  }

  if (block.itemCount_ !== undefined) {
    // ***Requires Localization***
    list.push(this.makeMutatorItem_(node, 'Add item', incrAttr('items')));

    if (block.itemCount_ > 0) {
      // ***Requires Localization***
      list.push(this.makeMutatorItem_(node, 'Remove item', decrAttr('items')));
    }
  }

  if (block.arguments_ != undefined) {
    // ***Requires Localization***
    list.push(this.makeMutatorItem_(node, 'Add argument', block => {
      var argname;
      if (block.arguments_.length) {
        var lastArg = block.arguments_[block.arguments_.length - 1];
        argname = (lastArg.length > 5)? lastArg:
          Blockly.Linearization.nextStackMarker(lastArg);
      } else {
        argname = 'A';
      }

      while (block.arguments_.includes(argname)) {
        argname += 'I';
      }
      var newVar = this.workspace.createVariable(argname);
      block.arguments_.push(argname);
      block.argumentVarModels_.push(newVar);
      block.updateParams_();
      this.listItemOnclick_(node);
    }));

    block.arguments_.forEach(arg => {
      var elem = this.makeTextItem(
        'Argument \"' + arg + '\"');
      elem.contentEditable = true;
      elem.addEventListener('focus', (e) => elem.innerText = arg);
      elem.addEventListener('blur', (event) => {
        if (elem.innerText === "") {
          block.arguments_.splice(block.arguments_.indexOf(arg), 1);
          block.updateParams_();
          this.listItemOnclick_(node);
        } else {
          var argModel = block.getVarModels()[block.arguments_.indexOf(arg)];
          this.workspace.renameVariableById(argModel.getId(), elem.innerText);
          block.updateParams_();
        }
      });

      list.push(elem);
    })
  }

  return list;
};

/**
 * Returns an html list item that encodes the mutator option defined by text,
 * with source node rootNode, and onclick listener innerFn that accepts
 * rootNode.getLocation(). (listItemOnclick_(rootNode) is performed
 * automatically.)
 * @param {!Blockly.ASTNode} node node containing the block with mutator
 * @param {!string} text option text
 * @param {!function(Blockly.Block)} mutFn additional onclick listener that
 * accepts node.getLocation()
 * @return {HTMLElement} an html list item encoding the mutator option defined
 * by node and text, with onclick behavior innerFn(node.getLocation())
 * @private
 */
Blockly.Linearization.prototype.makeMutatorItem_ = function(node, text, mutFn) {
  var block = node.getLocation();
  var elem = this.makeTextItem(text);
  elem.addEventListener('click', e => {
    mutFn(block);
    this.listItemOnclick_(node);
  })
  return elem;
};

/**
 * Creates and returns the HTML bold text option to duplicate the block being
 * moved to be used in parent-nav.
 * @param {?Blockly.ASTNode} blockNode the node for the block being moved
 * @return {?HTMLElement} an html representation of the option to duplicate,
 * null if not duplicatable, blockNode is null, or duplication is not checkable.
 * @private
 */
Blockly.Linearization.prototype.makeDuplicateItem_ = function(blockNode) {
  var block = blockNode && blockNode.getLocation();
  if (!block || !block.isDuplicatable || !block.isDuplicatable()) {
    return null;
  }
  var duplicateItem = this.createElement('b');
  // ***Requires Localization***
  duplicateItem.appendChild(document.createTextNode('Duplicate me'));
  duplicateItem.addEventListener('click', (e) => {
    var blockDom = Blockly.Xml.blockToDom(block);
    var newBlock = Blockly.Xml.domToBlock(blockDom, this.workspace);
    var xy = block.getRootBlock().getRelativeToSurfaceXY();
    newBlock.moveBy(xy.x + 50, xy.y + 50);
    this.blockJoiner.blockNode = null;
  });
  return duplicateItem;
};

/**
 * Returns a list text element with a unique id and block id of the node
 * passed it, as well as a custom onclick listener that pushes the attached node
 * to the this.blockJoiner and regenerate's the list
 * @param {!Blockly.ASTNode} node the node that contains the connection this
 * html element represents
 * @param {!string} text the text for this list item
 * @return {HTMLElement} a clickable list item that represents the connection
 * @private
 */
Blockly.Linearization.prototype.makeConnectionItem_ = function(node, text) {
  var item = this.makeTextItem(text);
  var connection = node.getLocation();
  item.id = "li" + connection.id;
  item.blockId = connection.id;
  item.style.color = 'hsl(0, 0%, 0%)';
  item.addEventListener('click', e => this.moveItemOnclick_(node, e));
  return item;
};

/**
 * Creates and returns the color-coded, linked HTML bold text of a parent block
 * used in parent-nav.
 * @param {?Blockly.ASTNode} node a parent node. If null, creates the
 * workspace ParentItem.
 * @return {HTMLElement} an html representation of node as a parent
 * @private
 */
Blockly.Linearization.prototype.makeParentItem_ = function(node) {
  var item = this.createElement('b');
  var labelText = Blockly.Linearization.makeNodeLabel(node);
  if (!node && !this.selected) {
    // ***Requires Localization***
    labelText += this.blockJoiner.blockNode? ' (move mode)': ' (summary)';
  }
  item.appendChild(document.createTextNode(labelText + ' > '));
  if (node) {
    item.style.color = 'hsl(' + node.getLocation().getHue() + ', 40%, 40%)';
  }
  // ***Requires Localization***
  item.setAttribute('aria-label', 'Jump to ' + labelText);
  item.addEventListener('click', e => this.listItemOnclick_(node));
  return item;
};

/**
 * Creates and returns the appropriately edittable HTML ListElement of node.
 * @param {!Blockly.ASTNode} node the input/field to represent
 * @return {HTMLElement} an edittable html representation of node
 * @private
 */
Blockly.Linearization.prototype.makeInputItem_ = function(node) {
  var location = node.getLocation();
  switch (node.getType()) {
    case Blockly.ASTNode.types.FIELD:
      if (location instanceof Blockly.FieldDropdown) {
        return this.makeDropdownItem_(node);
      }
      if (Blockly.FieldPitch && (location instanceof Blockly.FieldPitch)) {
        return this.makeDropdownItem_(node, true);
      }
      if (location instanceof Blockly.FieldNumber
          || location instanceof Blockly.FieldTextInput) {
        return this.makeEditableFieldItem_(location, node);
      }
      if (location instanceof Blockly.FieldLabel) {
        console.log(location.getText());
        return this.makeTextItem_(location.getText());
      }
      var fallthroughText = 'field but neither dropdown nor number';
      return this.makeTextItem(fallthroughText);
    case Blockly.ASTNode.types.INPUT:
      if (location.targetConnection) {
        var targetInputs = location.targetConnection.getSourceBlock().inputList;
        if ((targetInputs[0].fieldRow[0] instanceof Blockly.FieldNumber)) {
          return this.makeEditableFieldItem_(targetInputs[0], node);
        }
        var targetBlockNode = node.in().next();
        if (targetBlockNode.getLocation().outputConnection) {
          return this.makeBlockItem_(targetBlockNode);
        }
      }
      break;
    case Blockly.ASTNode.types.OUTPUT:
      break;
    default: // should never happen
      console.warn('uncaught', node);
  }
  return null;
};

/**
 * Returns an ordered Array of linked html list items that represent the
 * list of branches on the if block the node contain
 * @param {!Blockly.ASTNode} node the node containing an if block to represent
 * @return {Array<HTMLElement>} the html representation of node and its branches
 * @private
 */
Blockly.Linearization.prototype.makeIfList_ = function(node) {
  const branches = node.branch? [node.branch]:
      Blockly.Linearization.getIfBranches(node);
  var list = [];

  if (node.branch && node.branch.condNode) {
    list.push(this.makeBlockItem_(node.branch.condNode));
  } else if (branches.length === 1 && branches[0].condNode) {
    list.push(this.makeBlockItem_(branches[0].condNode));
  }

  for (var branch of branches) {
    list.push(this.makeIfBracketItem_(node, branch));

    var bracketItemList = this.createElement('ul');
    list.push(bracketItemList);

    if (branch.bodyNode) {
      branch.bodyNode.collect(n => n.nextBlock())
        .map(node => this.makeNodeItems_(node))
        .forEach(items => bracketItemList.append(...items));
      continue;
    }

    if (this.blockJoiner.blockNode) {
      var body = Blockly.ASTNode.createConnectionNode(branch.bodyConnection);
      var text = 'Insert within ' + branch.text;
      var listItem = this.makeConnectionItem_(body, text);
      bracketItemList.appendChild(listItem);
      continue;
    }

    bracketItemList.appendChild(this.makeTextItem(this.blankText_));
  }

  if (node.branch) {
    var viewAllItem = this.makeBlockItem_(node, null);
    // ***Requires Localization***
    viewAllItem.innerHTML = 'View all branches...';
    list.push(viewAllItem);
  }

  return list;
};

/**
 * Creates and returns the standard HTML list element to represent the header of
 * the if block in node, on the provided branch
 * @param {!Blockly.ASTNode} node the block to represent
 * @param {!Object} branch the if branch to label
 * @return {HTMLElement} an html list item header for the branch on node
 * @private
 */
Blockly.Linearization.prototype.makeIfBracketItem_ = function(node, branch) {
  var text = branch.text;
  if (branch.type !== 3) {
    text += ' ';
    text += branch.condNode?
        branch.condNode.getLocation().makeAriaLabel():
        this.blankText_;
    // ***Requires Localization***
    text += ' do';
  }

  var bracketItem;
  try {
    var blockNode = this.blockJoiner.blockNode;
    var condConnectionNode = Blockly.ASTNode.createConnectionNode(branch.condConnection);
    if (Blockly.Linearization.checkConnection(condConnectionNode, blockNode.prev())) {
      // ***Requires Localization***
      bracketItem = this.makeConnectionItem_(condConnectionNode,
          text + ' (click to fill)');
    } else {
      bracketItem = this.makeBlockItem_(node, branch);
      bracketItem.firstChild.textContent = text;
    }
  } catch(e) {
    bracketItem = this.makeBlockItem_(node, branch);
    bracketItem.firstChild.textContent = text;
  }
  return bracketItem;
};

/**
 * Creates and returns the standard ListElement for the block in node, labelled
 * with text equivalent to node.getLocation().makeAriaLabel().
 * Attributes include a unique id and blockId for the associated block, as well
 * adding the standard listItemOnclick_(node, branch) event listener on click.
 * @param {!Blockly.ASTNode} node the block to represent
 * @param {?Object} branch the if branch to navigate to
 * @return {HTMLElement} an linked html list item representation of node
 * @private
 */
Blockly.Linearization.prototype.makeBlockItem_ = function(node, branch) {
  var block = node.getLocation();
  var text = block.makeAriaLabel();
  var blockNode = this.blockJoiner.blockNode;
  if (blockNode && blockNode.getLocation().id === node.getLocation().id) {
    // ***Requires Localization***
    text += ' (moving me...)';
  }
  var item = this.makeTextItem(text);
  item.firstChild.setAttribute('role', 'button');
  item.setAttribute('id', "li" + block.id);
  item.setAttribute('blockId', block.id);
  item.addEventListener('click', e => this.listItemOnclick_(node, branch));
  var colorString = 'hsl(' + node.getLocation().getHue() + ', 40%, 40%)';
  item.style.color = colorString;
  return item;
};

/**
 * Creates and returns a textfield HTML li element linked to node's value.
 * @param {!Blockly.ASTNode} node the field or input to represent
 * @return {HTMLElement} an html list item that is edittable for number
 * and text fields.
 * @private
 */
Blockly.Linearization.prototype.makeEditableFieldItem_ = function(item, node) {
  var listElem;
  // this function acceps both inputs and fields, so we determine which here
  // an input will have .fieldRow[0], a field won't
  var field = item.fieldRow ? item.fieldRow[0] : item;

  if (field instanceof Blockly.FieldDropdown) {
    return this.makeDropdownItem_(node, false);
  }

  var fieldName = field.name;
  listElem = this.createElement('input');
  listElem.setAttribute('id', 'li' + field.getSourceBlock().id);

  if (field instanceof Blockly.FieldTextInput) {
    listElem.setAttribute('type', 'text');
  }

  if (field instanceof Blockly.FieldNumber) {
    listElem.setAttribute('type', 'number');
  }

  listElem.setAttribute('value', field.getText());

  listElem.addEventListener('blur', (event) => {
    Blockly.Events.disable();
    var block = this.workspace.getBlockById(listElem.id.slice(2));
    field.setValue(listElem.value);
    Blockly.Events.enable();
    this.generateParentNav_(node);
  });
  listElem.addEventListener('keyup', (event) => {
    if (event.keyCode === 13) {
      listElem.blur();
    }
  });
  return listElem;
};

/**
 * Returns the html list element representing field, null if an invalid field
 * @param {!Blockly.ASTNode} node the node which points to field
 * @param {Boolean} pitch whether or not the field is a Blockly.FieldPitch
 * @return {?HTMLElement} a clickable representation of the field that toggles
 * options through the dropdown option list. If there are no options, null.
 */
Blockly.Linearization.prototype.makeDropdownItem_ = function(node, pitch) {
  var elem = this.createElement('select');
  var field = node.getLocation();

  if (pitch) {
    var notes = ['C3', 'D3', 'E3', 'F3', 'G3', 'A3', 'B3', 'C4', 'D4', 'E4', 'F4', 'G4', 'A4'];
    var options = [];
    for (var i=0, note; note = notes[i]; i++) {
      var option = [note, i];
      options.push(option);
    }
    elem.style.width = (document.getElementById('staveBox').offsetWidth - 40) + 'px';
  } else {
    var options = field.getOptions();
    elem.style.width = this.mainNavList.offsetWidth + 'px';
  }

  if (!options.length) {
    return null;
  }

  for (var i=0, option; option = options[i]; i++) {
    var item = this.createElement('option');
    item.setAttribute('value', option[1]);

    item.textContent = option[0].alt || option[0];
    if (option[1] === field.getValue() || option[1] === field.getText()) {
      item.setAttribute('selected', 'selected');
    }

    elem.appendChild(item);
  }

  elem.addEventListener('change', (event) => {
    Blockly.Events.disable();
    field.setValue(elem.options[elem.selectedIndex].value);
    Blockly.Events.enable();
    this.generateParentNav_(node);
  })
  return elem;
};

/**
 * Returns the html list element representing the pitch field, null if an invalid field
 * @param {!Blockly.FieldPitch} field the field to represent
 * @return {?HTMLElement} a clickable representation of the field that toggles
 * options through the dropdown option list. If there are no options, null.
 */
Blockly.Linearization.prototype.makePitchItem_ = function(field) {
  var options = ['C3', 'D3', 'E3', 'F3', 'G3', 'A3', 'B3', 'C4', 'D4', 'E4', 'F4', 'G4', 'A4'];

  var text = '';
  var value = 0;
  for (var i = 0, option; option = options[i]; i++) {
    if (option === field.getText()) {
      text = option;
      value = i;
      break;
    }
  }

  var labelText = 'Field: ' + text;
  var elem = this.makeTextItem(labelText);
  // ***Requires Localization***
  elem.setAttribute('aria-label', labelText + ', click to change');
  elem.setAttribute('index', value);
  elem.addEventListener('click', e => {
    Blockly.Events.disable();
    const oldIndex = parseInt(elem.getAttribute('index'));
    var offset = 1;
    while (offset < options.length) {
      var newIndex = (oldIndex + offset) % options.length;
      var text = options[newIndex];
      var newLabelText = 'Field: ' + text;
      var textNode = document.createTextNode(newLabelText);
      // ***Requires Localization***
      elem.setAttribute('aria-label', newLabelText + ', click to change');
      elem.setAttribute('index', newIndex);

      try {
        field.setValue(newIndex);
        elem.replaceChild(textNode, elem.firstChild);
        break;
      } catch (e) { // not a variable, so value can't be set
        console.warn('not a valid variable', option);
      } finally {
        offset++;
      }
    }
    this.generateParentNav_(this.selected);
    Blockly.Events.enable();
  });
  return elem;
};

/**
 * Creates and returns a linked HTML li element linked to node's direct visual
 * parent.
 * @param {!Blockly.ASTNode} node the child node of the parent to go back to
 * @return {HTMLElement} an html list item that will navigate to the direct
 * visual parent block
 */
Blockly.Linearization.prototype.makeGoBackItem_ = function(node) {
  var outNode = node.out();
  while (outNode && outNode.getType() !== 'block') {
    outNode = outNode.out();
  }
  // ***Requires Localization***
  var text = 'Go back to ' + Blockly.Linearization.makeNodeLabel(outNode);
  var goBackNode = this.makeTextItem(text);
  goBackNode.addEventListener('click', e => this.listItemOnclick_(outNode));
  return goBackNode;
};

/**
 * Creates and returns a linked HTML li element linked to a function w/return
 * node's return value block
 * @param {!Blockly.ASTNode} rootNode the node that contains the function block
 * @param {!Blockly.ASTNode} inNode
 * @return {HTMLElement} an html list item that will navigate to the return
 * value of the block
 */
Blockly.Linearization.prototype.makeReturnItem_ = function(rootNode) {
  var inNode = rootNode.in();
  while (inNode && inNode.getType() !== Blockly.ASTNode.types.INPUT) {
    inNode = inNode.next();
  }
  var returnNode = inNode.collect(n => n.next()).find(n =>
    n.getLocation().getParentInput() &&
    n.getLocation().getParentInput().type === 1);
  if (returnNode.in() && returnNode.in().next()) {
    var returnBlock = returnNode.in().next();
    var returnListItem = this.makeBlockItem_(returnBlock);
    returnListItem.firstChild.innerHTML = this.returnText_ +
        returnListItem.firstChild.innerHTML;
    return returnListItem;
  }

  var blockNode = this.blockJoiner.blockNode;
  if (blockNode &&
      Blockly.Linearization.checkConnection(returnNode, blockNode.prev())) {
    return this.makeConnectionItem_(returnNode, 'Insert in return');
  }

  return this.makeTextItem(this.returnText_ + this.blankText_);
};

/**
 * Creates and returns an li element that pushes the node to this.blockJoiner
 * on click
 * @param {!Blockly.ASTNode} node the node to be moved on click
 * @return {HTMLElement} a labeled html list item that will fire
 * this.moveItemOnclick_(node) when clicked.
 */
Blockly.Linearization.prototype.makeMoveItem_ = function(node) {
  // ***Requires Localization***
  var text = this.blockJoiner.blockNode? 'Move me instead': 'Move me and blocks below';
  var element = this.makeTextItem(text);
  element.addEventListener('click', e => this.moveItemOnclick_(node, e));
  return element;
};

/**
 * Pushes the node to this.blockJoiner, and navigates to the workspace level
 * linearization
 * @param {!Blockly.ASTNode} node the node to be pushed
 * @private
 */
Blockly.Linearization.prototype.moveItemOnclick_ = function(node, e) {
  try {
    var successfulConnection = this.blockJoiner.push(node);
    // can fail and not throw an exception
    if (successfulConnection) {
      this.selected = null;
      this.generateList_();
    }
  } catch (e) {
    console.warn('Unsuccessful push', e);
  }
};

/**
 * The standard onclick action for ListElements. Highlights the node's block if
 * node is not null, sets the selected to node, and calls generateList_().
 * @param {?Blockly.ASTNode} node the node to navigate to and highlight
 * @param {?Object} branch the if-branch to display
 * @private
 */
Blockly.Linearization.prototype.listItemOnclick_ = function(node, branch) {
  this.highlightBlock(node && node.getLocation());
  this.selected = node;
  if (node) {
    this.selected.branch = branch;
  }
  this.generateList_();
};

/**
 * Creates and returns an HTML li element with a text node reading text.
 * @param {tring}s$3 text the text on the list item
 * @return {HTMLElement} an html list item with text node text
 */
Blockly.Linearization.prototype.makeTextItem = function(text) {
  var listElem = this.createElement('li');
  var spanElem = this.createElement('span');
  spanElem.appendChild(document.createTextNode(text));
  listElem.appendChild(spanElem);
  return listElem;
};

/**
 * Creates and returns an HTML element with tag type, and inherited font-size
 * property
 * @param {!string} type the type of html element
 */
Blockly.Linearization.prototype.createElement = function(type) {
  var elem = document.createElement(type);
  elem.style['font-size'] = this.fontSize_ + 'pt';
  return elem;
};

/**
 * Highlights block if block is not null. Sets lastHighlighted to block.
 * @param {?Blockly.ASTNode} block block to highlight, null if none
 */
Blockly.Linearization.prototype.highlightBlock = function(block) {
  this.clearHighlighted();
  if (block) {
    block.setHighlighted(true);
  }
  this.lastHighlighted = block;
};

/**
 * Unhighlights lastHighlighted, if lastHighlighted is not null.
 */
Blockly.Linearization.prototype.clearHighlighted = function() {
  if (this.lastHighlighted) {
    this.lastHighlighted.setHighlighted(false);
  }
};

/**
 * Sets the size of the font for the linearization and calls generateList_()
 * @param {number} size the new font size for the linearization
 */
Blockly.Linearization.prototype.setFontSize = function(size) {
  this.fontSize_ = size;
  this.generateList_();
};

/**
 * Sets the number of pixels wide the list indent should be in mainNavList and
 * calls applyNavStyle_();
 * @param {number} pixels the new indent width for the linearization
 */
Blockly.Linearization.prototype.setIndentPixels = function(pixels) {
  this.indentPixels_ = pixels;
  this.applyNavStyle_();
};

/**
 * Returns whether or not conn can connect to blockConn.
 * @param {!Blockly.ASTNode} conn the node containing the main connection point
 * @param {!Blockly.ASTNode} blockConn the node containing the connection point
 * on a block where that block might be connected to conn
 */
Blockly.Linearization.checkConnection = function(conn, blockConn) {
  try {
    conn.getLocation().checkConnection_(blockConn.getLocation());
  } catch(e) {
    return false;
  }

  var parentBlocks = conn.collect(n => n.ascend())
      .filter(n => n.getType() === Blockly.ASTNode.types.BLOCK)
      .map(n => n.getLocation());
  return !parentBlocks.includes(blockConn.getLocation().getSourceBlock());
};

/**
 * Returns the list of objects representing each branch of the if in order
 * @param {!Blockly.ASTNode} ifNode the node containing the if block
 * @return {Array<Object>} the list of branches
 */
Blockly.Linearization.getIfBranches = function(ifNode) {
  const children = ifNode.in().collect(n => n.next());
  var branches = [];
  for (var i = 0; i < children.length; i += 2) {
    var branch = {key: i / 2};
    if (i === children.length - 1) {
      // ***Requires Localization***
      branch.type = 3;
      // ***Requires Localization***
      branch.text = 'else';
      branch.bodyIndex = i;
    } else {
      branch.type = i? 2: 1;
      // ***Requires Localization***
      branch.text = i? 'else if': 'if';

      branch.condIndex = i;
      branch.condConnection = children[i].getLocation();
      var condItem = children[i] && children[i].in();
      branch.condNode = condItem && condItem.next();

      branch.bodyIndex = i + 1;
    }

    branch.bodyConnection = children[branch.bodyIndex].getLocation();
    var bodyItem = children[branch.bodyIndex].in();
    branch.bodyNode = bodyItem && bodyItem.next();

    branches.push(branch);
  }

  return branches;
};

/**
 * Takes in a nesting block (e.g. if, repeat while, etc.) and returns a
 * shorthand human-readable identifier.
 * @param {Blockly.Block} block the block to find a name for
 * @return {string} readable identifier for the nesting block
 */
Blockly.Linearization.getNestingBlockName = function(block) {
  // ***Requires Localization***
  var blockNames = {
    'controls_if': 'if',
    'controls_repeat_ext': 'repeat',
    'controls_forEach': 'for each',
    'controls_for': 'for',
    'procedures_defnoreturn': 'function',
    'procedures_defreturn': 'function',
    'controls_whileUntil': 'repeat while'
  }
  if ((block.type === 'controls_whileUntil'
      && block.inputList[0].fieldRow[1].getText() === 'until')) {
    blockNames['controls_whileUntil'] = 'repeat until';
  }
  return blockNames[block.type];
};

/**
 * Creates and returns the aria label for node if
 * node.getLocation().makeAriaLabel is not null, 'workspace' if otherwise.
 * @param {?Blockly.ASTNode} node the node to get aria-label from
 * @return {string} the string generated by node.getLocation().makeAriaLabel()
 */
Blockly.Linearization.makeNodeLabel = function(node) {
  // ***Requires Localization***
  return node && node.getLocation().makeAriaLabel?
      node.getLocation().makeAriaLabel(): 'workspace';
};

/**
 * Seeks the next inline input on node's AST parent after node itself.
 * @param {!Blockly.ASTNode} node the last sibiling searched
 * @return {Blockly.ASTNode} the first inline sibling after node, null if none.
 */
Blockly.Linearization.nextInlineInput = function(node) {
  var next = node.next();
  if (next && next.getType() === Blockly.ASTNode.types.FIELD) {
    return next;
  }
  if (next && next.in() &&
     next.in().getType() != Blockly.ASTNode.types.PREVIOUS) {
    return next;
  }
  return null;
};

/**
 * Creates and returns the next label in lexicographic order, adding a letter in
 * the event of overflow.
 * @param {!string} marker the last node created
 * @return {string} the next label after marker in lexicographic order
 */
Blockly.Linearization.nextStackMarker = function(marker) {
  var lastIndex = marker.length - 1;
  var prefix = marker.slice(0, lastIndex);
  if (marker.charCodeAt(lastIndex) === 'Z'.charCodeAt(0)) {
    return (prefix? this.nextStackMarker(prefix): 'A') + 'A';
  }
  return prefix + String.fromCharCode(marker.charCodeAt(lastIndex) + 1);
};
