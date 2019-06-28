/**
 * @fileoverview The class for generating accessible linearization
 * of a workspace, and a helper classes
 */

goog.provide('Blockly.Linearization');
goog.provide('Blockly.Linearization.BlockJoiner');

/**
 * Class for generating the linearization of a workspace, displayed in
 * parent nav and mainNavList.
 *
 * @constructor
 * @param {!Blockly.Workspace} workspace the main workspace to represent
 * @param {HTMLElement} parentNav the p element to display the parent
 * breadcrumbs within
 * @param {HTMLElement} mainNavList the p element to display the main
 * linearization of workspace within
 */
Blockly.Linearization = function(workspace, parentNav, mainNavList) {
  this.workspace = workspace;
  this.parentNav = parentNav;
  this.mainNavList = mainNavList;
  this.blockJoiner = new Blockly.Linearization.BlockJoiner();
  workspace.addChangeListener(e => this.generateList_(e));
}

/**
 * Class to manage requests for blocks from connections, and vice-versa.
 * Allows for a single connection request and a single block request at a time.
 * @constructor
 */
Blockly.Linearization.BlockJoiner = function() {}

/**
 * Attempt to fill the request for this item. item must be Blockly.Block or
 * Blockly.Connection.
 * @param {Block.ASTNode} item
 * @return {boolean} true if successfully pushed, false if request fails
 */
Blockly.Linearization.BlockJoiner.prototype.push = function(item) {
  if (item.getLocation() instanceof Blockly.Block) {
    this.blockNode = item;
  } else if (item.getLocation() instanceof Blockly.Connection) {
    this.connectionNode = item;
  } else {
    return false;
  }

  this.service_();
  return true;
}

/**
 * Attempt to pair blockNode and connectionNode. If successful, join the
 * connections, and then clear them.
 * @private
 */
Blockly.Linearization.BlockJoiner.prototype.service_ = function() {
  if (!(this.blockNode && this.connectionNode)) {
    return;
  }

  var insertPointNode = this.connectionNode;
  var advance, back;
  // define advance and back by the direction the connection node requests
  switch (insertPointNode.getType()) {
    case Blockly.ASTNode.types.NEXT:
    case Blockly.ASTNode.types.INPUT:
      advance = n => n.next();
      back = n => n.prev();
      break;
    case Blockly.ASTNode.types.PREVIOUS:
      advance = n => n.prev();
      back = n => n.next();
      break;
    default:
      console.warn('fell through', insertPointNode);
      return;
  }

  // connect this.blockNode and this.connectionNode
  var provided = this.blockNode;
  var providedBlock = back(provided).getLocation();

  try {
    var detach = [Blockly.ASTNode.types.PREVIOUS, Blockly.ASTNode.types.OUTPUT];
    if (provided.prev() && provided.prev().prev()
        && detach.includes(provided.prev().getType())) {
      provided.prev().getLocation().disconnect();
    }
  } catch (e) {
    console.warn('unsuccessful disconnect', e);
  }

  try {
    insertPointNode.getLocation().connect(providedBlock);
  } catch (e) {
    console.warn(e);
    if (e instanceof DOMException) {
      document.location.reload();
    }
  }
  // clear the values
  this.connectionNode = null;
  this.blockNode = null;
}

/**
 * Attempts to disconnect the current block in this.blockNode and put in on the
 * workspace. Nulls this.blockNode if successful
 */
Blockly.Linearization.BlockJoiner.prototype.disconnectBlock = function() {
  if (!this.blockNode) {
    return;
  }

  try {
    this.blockNode.prev().getLocation().disconnect();
    this.blockNode = null;
  } catch (e) { /* unsuccessful disconnect */  }
}

/**
 * Checks if the block in this.blockNode is equal to the block in node
 * @param {Blockly.ASTNode} node the node to compare to
 * @return {Boolean} true if they contain the same block and are not null, false
 * otherwise
 */
Blockly.Linearization.BlockJoiner.prototype.blockIs = function(node) {
  return this.blockNode && node && this.blockNode.getLocation().id != undefined
    && this.blockNode.getLocation().id === node.getLocation().id;
};

/**
 * The ChangeListener for workspace events. On fire, fully redraws
 * linearization, including parentNav.
 * @param {?Blockly.Events.Abstract=} e undefined by default, the workspace
 * event that triggers this ChangeListener.
 * @private
 */
Blockly.Linearization.prototype.generateList_ = function(e=undefined) {
  var workspace = this.workspace;
  if (!workspace.getAllBlocks().length) {
    this.mainNavList.innerHTML = '';
    return;
  }

  if (e) {
    this.alterSelectedWithEvent_(e);
  }

  this.generateParentNav_(this.selectedNode);

  var navListDiv = this.mainNavList;
  var newDiv = this.selectedNode?
      this.makeNodeList_(this.selectedNode):
      this.makeWorkspaceList_();

  newDiv.setAttribute('id', 'mainNavList');
  navListDiv.parentNode.replaceChild(newDiv, navListDiv);
  this.mainNavList = newDiv;
}

/**
 * Takes a workspace event and uses the type of event to determine the next
 * selectedNode.
 * @param {Blockly.Events.Abstract} e the workspace event that determines the
 * next selectedNode.
 * @private
 */
Blockly.Linearization.prototype.alterSelectedWithEvent_ = function(e) {
  var workspace = this.workspace;
  var node;
  switch (e.type) {
    case Blockly.Events.BLOCK_MOVE:
      var block = workspace.getBlockById(e.blockId);
      node = block && Blockly.ASTNode.createBlockNode(block);
      if (block && this.blockJoiner.connectionNode) {
        this.blockJoiner.push(node);
      }
      break;
    case Blockly.Events.FINISHED_LOADING:
      node = null;
      break;
    case Blockly.Events.BLOCK_CREATE:
      var block = workspace.getBlockById(e.blockId);
      node = block && Blockly.ASTNode.createBlockNode(block);
      break;
    case Blockly.Events.UI:
      if (e.element !== 'selected' && e.element !== 'click') {
        node = this.selectedNode;
      } else if (!e.blockId) {
        node = null;
      } else {
        var block = workspace.getBlockById(e.blockId);
        node = Blockly.ASTNode.createBlockNode(block);
        if (this.blockJoiner.connectionNode) {
          this.blockJoiner.push(node);
        }
      }
      break;
    case Blockly.Events.BLOCK_DELETE:
      node = null;
      break;
  }

  this.listItemOnclick(node);
}

/**
 * Generates (and replaces) the old parent-nav bar, using color-coded, linked
 * breadcrumbs. Always includes workspace.
 * @param {!Blockly.Workspace} Current workspace
 * @param {?Blockly.ASTNode} rooNode Generates breadcrumbs from rootNode's
 * parentStack up to and including rootNode.
 * @private
 */
Blockly.Linearization.prototype.generateParentNav_ = function(rootNode) {
  var pNav = this.parentNav;
  pNav.innerHTML = '';
  pNav.appendChild(this.makeParentItem_());

  if (rootNode) {
    rootNode.getParentStack(true)
        .filter(node => node.getType() === Blockly.ASTNode.types.BLOCK)
        .reverse()
        .map(node => this.makeParentItem_(node))
        .forEach(elem => pNav.appendChild(elem));
  }

  // add movement options...
  // ...cancel move item...
  var blockNode = this.blockJoiner.blockNode;
  if (this.blockJoiner.connectionNode || blockNode) {
    pNav.appendChild(document.createElement('br'));
    var cancelItem = document.createElement('b');
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
  if (blockNode && !this.selectedNode) {
    pNav.appendChild(document.createElement('br'));
    var deleteItem = document.createElement('b');
    var text = 'Delete ' + blockNode.getLocation().makeAriaLabel();
    deleteItem.appendChild(document.createTextNode(text));
    deleteItem.addEventListener('click', e => {
      this.blockJoiner.blockNode = null;
      blockNode.getLocation().dispose(true);
    })

    // ...make into new stack item
    if (blockNode.prev()) {
      // if this has the ability to be mid-stack (unlike hat blocks)
      pNav.appendChild(deleteItem);
      pNav.appendChild(document.createElement('br'));
      var newStackItem = document.createElement('b');
      newStackItem.appendChild(document.createTextNode('Start new stack'));
      newStackItem.addEventListener('click', e => {
        this.blockJoiner.disconnectBlock();
      });
      pNav.appendChild(newStackItem);
    }
  }
}

/**
 * Creates and returns the HTML unordered list of labelled stacks with sublists
 * of every block on the same visual indent, represented with list elements
 * @return {HTMLElement} an html representation of the top level of the current
 * workspace, in the form of an unordered list.
 * @private
 */
Blockly.Linearization.prototype.makeWorkspaceList_ = function() {
  var workspace = this.workspace;
  var wsNode = Blockly.ASTNode.createWorkspaceNode(workspace);
  var wsList = document.createElement('ul');

  // for each stack
  var firstStack = wsNode.in();
  var stacks = firstStack.sequence(n => n.next());
  this.marker = 'A';

  // is in move mode? partial: full;
  var mappingFn = this.blockJoiner.blockNode?
      stack => this.makePartialStackItem_(stack):
      stack => this.makeFullStackItem_(stack);

  stacks.map(mappingFn)
    .forEach(item => wsList.append(item));

  return wsList;
}

/**
 * Generates the stack item that contains all the top-level information
 * as well as movement options for the provided stack. Designed for use during
 * move operations
 * @param {!Blockly.ASTNode} stack the stack to represent
 * @return {HTMLElement} a list element describing the top-level of the stack as
 * a color-coded, linked sublist
 */
Blockly.Linearization.prototype.makePartialStackItem_ = function(stack) {
  var stackItem = document.createElement('li');
  stackItem.appendChild(document.createTextNode('Stack ' + this.marker));
  this.marker = Blockly.Linearization.nextStackMarker(this.marker);
  var stackItemList = document.createElement('ul');

  // for each block node in the top of the stack
  var firstNode = stack.in();
  if (firstNode.getType() !== Blockly.ASTNode.types.BLOCK) {
    firstNode = firstNode.getFirstSiblingBlock();
  }

  // add a new list element representing the block to the list
  firstNode.sequence(n => n.getFirstSiblingBlock())
    .map(node => this.makeNodeListItems_(node))
    .forEach(items => stackItemList.append(...items));

  stackItem.appendChild(stackItemList);
  return stackItem;
}

/**
 * Generates the html li that contains listings for all items in the stack
 * @param {!Blockly.ASTNode} stack the stack to represent
 * @return {HTMLElement} a list element describing the complete stack as
 * a color-coded, linked sublist
 */
Blockly.Linearization.prototype.makeFullStackItem_ = function(stackNode) {
  var stackItem = document.createElement('li');
  var stackElem =
      Blockly.Linearization.makeListTextItem_('Stack ' + this.marker);
  stackElem.contentEditable = true;
  stackElem.addEventListener('focus', (e) => {
    var oldName = stackElem.innerText.slice(6);
    stackElem.innerText = oldName;
  });
  stackElem.addEventListener('blur', (e) => {
    if (stackElem.innerText === "") {
      stackElem.innerText = 'Stack ' + oldName;
    } else {
      var newName = stackElem.innerText;
      stackElem.innerText = 'Stack ' + newName;
    }
  });
  stackItem.appendChild(stackElem);
  this.marker = Blockly.Linearization.nextStackMarker(this.marker);
  var stackItemList = document.createElement('ul');

  // first block in stack
  var blockNode = stackNode.in();
  if (blockNode.getType() !== Blockly.ASTNode.types.BLOCK) {
    blockNode = blockNode.getFirstSiblingBlock();
  }
  var rootBlock = blockNode.getLocation();
  blockNode.sequence(n => n.getFirstSiblingBlock())
    .map(node => this.drawListForBlock(node, rootBlock, stackItemList));

  stackItem.appendChild(stackItemList);
  return stackItem;
}

/**
 * Takes in a block node and recursively makes the list of elements for all
 * descendant blocks.
 * Excludes inline blocks, such as those found in the repeat x times block.
 * @param {Blockly.ASTNode} blockNode the block AST node to start from
 * @param {Blockly.Block} rootBlock the block at which blockNode points to
 * @param stackItemList TODO: fill me in
 * @param {HTMLElement} the HTML list to add the list elements to
 */
Blockly.Linearization.prototype.drawListForBlock = function(blockNode,
    rootBlock, stackItemList) {
  var block = blockNode.getLocation();
  if (blockNode.getType() === Blockly.ASTNode.types.BLOCK
    && !(block.outputConnection && block.getParent())
    && block.getRootBlock() === rootBlock) {

    var listElem = this.makeBasicListItem_(blockNode);
    if (block.getSurroundParent()) {
      listElem.setAttribute('aria-label', listElem.innerHTML
        + ', inside ' + this.getNestingBlockName(block.getSurroundParent()));
    }
    stackItemList.append(listElem);
  }

  if (blockNode.getFirstNestedBlock()) {
    var nestedItemList = document.createElement('ul');
    // nestedItemList.setAttribute('style', 'list-style-type:none;');
    blockNode.getFirstNestedBlock().sequence(n => n.getFirstSiblingBlock())
      .map(node => this.drawListForBlock(node, rootBlock, nestedItemList));
    stackItemList.append(nestedItemList);
  }
  if (this.getNestingBlockName(block)) {
    var endElem = Blockly.Linearization.makeListTextItem_(
        'end ' + this.getNestingBlockName(block));
    stackItemList.append(endElem);
  }
}

/**
 * Takes in a nesting block (e.g. if, repeat while, etc.) and returns a
 * shorthand human-readable identifier.
 * @param {Blockly.Block} block the block to find a name for
 * @return {string} readable identifier for the nesting block
 */
Blockly.Linearization.prototype.getNestingBlockName = function(block) {
  // TODO: localization
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
  if (blockNames[block.type]) {
    return blockNames[block.type];
  }
  return null;
}

  /**
 * Creates and returns the HTML unordered list of every block on the same visual
 * indent within the rootNode, represented with list elements
 * @param {!Blockly.ASTNode} rootNode the direct parent of all items in the list
 * @return {HTMLElement} an html representation of the top level of the
 * rootNode, in the form of an unordered list.
 * @private
 */
Blockly.Linearization.prototype.makeNodeList_ = function(rootNode) {
  var sublist = document.createElement('ul');
  sublist.appendChild(this.makeGoBackItem_(rootNode));
  sublist.appendChild(this.makeMoveItem_(rootNode));

  var warning = rootNode.getLocation().warning;
  if (warning && warning.getText && warning.getText().length) {
    sublist.appendChild(
      Blockly.Linearization.makeListTextItem_(warning.getText()));
  }

  var connNode = this.blockJoiner.connectionNode;
  var inlineOutputConn = connNode && connNode.getParentInput() &&
      connNode.getParentInput().type === Blockly.INPUT_VALUE;

  var prevConn = rootNode.prev();
  if (prevConn && connNode) {
    sublist.appendChild(this.makeConnListItem_(rootNode, prevConn,
        inlineOutputConn? 'Tack me on side of': 'Insert me below',
        'Insert above me'));
  }

  var inline = rootNode.getFirstInlineBlock();
  if (inline) {
    var inlineSeq = inline.sequence(Blockly.Linearization.nextInlineInput);
    inlineSeq.map(node => this.makeInputListItem_(node))
      .filter(Boolean)
      .forEach(elem => sublist.appendChild(elem));
  }

  if (rootNode.getLocation().mutator) {
    sublist.append(...this.makeAllMutatorItems_(rootNode));
  }

  var inNode = rootNode.in();
  while (inNode && inNode.getType() !== Blockly.ASTNode.types.INPUT) {
    inNode = inNode.next();
  }

  var firstNested = rootNode.getFirstNestedBlock();

  if (rootNode.getLocation().type === 'controls_if') {
    sublist.append(...this.makeIfListItems_(rootNode));
  } else if (firstNested) {
    firstNested.sequence(n => n.getFirstSiblingBlock())
        .map(node => this.makeNodeListItems_(node))
        .forEach(elems => sublist.append(...elems));
  } else if (!connNode && inNode) {
      sublist.append(...this.makeAllInnerInputItems_(inNode));
  }

  return sublist;
}

/**
 * Returns all inner input nodes as a array of html elements, starting with
 * inNode.
 * @param {!Blockly.ASTNode} inNode the first inner input element to convert
 * @return {Array<HTMLElement>} an array containing all inner input elements
 * encoded as html list items
 * @private
 */
Blockly.Linearization.prototype.makeAllInnerInputItems_ = function(inNode) {
  if (!this.blockJoiner.blockNode) {
    return [];
  }
  var inNodeSeq = inNode.sequence(n => n.next());
  var counter = {
    tackVal: 1,
    insertVal: 1,
    tackText: () => (inNodeSeq.length == 1)? '': ' ' + counter.tackVal++,
    insertText: () => (inNodeSeq.length == 1)? '':' ' + counter.insertVal++
  }
  return inNodeSeq.map(n => this.makeBasicConnListItem_(
            n,
            n.getParentInput() && n.getParentInput().type === Blockly.INPUT_VALUE?
                'Tack on side' + counter.tackText():
                'Insert within' + counter.insertText())
          );
}

/**
 * Returns all mutator options for the block rootNode wraps in an array.
 * @param {!Blockly.ASTNode} rootNode node containing the block with mutator
 * @return {Array<HTMLElement>} an array containing all mutator options encoded
 * as html list items.
 * @private
 */
Blockly.Linearization.prototype.makeAllMutatorItems_ = function(rootNode) {
  var block = rootNode.getLocation();
  var list = [];

  if (block.elseifCount_ != undefined) {
    list.push(this.makeMutatorListItem_(rootNode, 'Add elseif', block => {
      block.elseifCount_++;
      block.rebuildShape_();
    }));

    if (block.elseifCount_ > 0) {
      list.push(this.makeMutatorListItem_(rootNode, 'Remove elseif',
      block => {
        block.elseifCount_--;
        block.rebuildShape_();
      }));
    }
  }

  if (block.elseCount_ === 0) {
    list.push(this.makeMutatorListItem_(rootNode, 'Add else', block => {
      block.elseCount_++;
      block.rebuildShape_();
    }));
  } else if (block.elseCount_ === 1) {
    list.push(this.makeMutatorListItem_(rootNode, 'Remove else', block => {
      block.elseCount_--;
      block.rebuildShape_();
    }));
  }

  if (block.itemCount_ != undefined) {
    list.push(this.makeMutatorListItem_(rootNode, 'Add item', block => {
      block.itemCount_++;
      block.updateShape_();
    }));

    if (block.itemCount_ > 1) {
      list.push(this.makeMutatorListItem_(rootNode, 'Remove item', block => {
        block.itemCount_--;
        block.updateShape_();
      }));
    }
  }

  if (block.arguments_ != undefined) {
    list.push(this.makeMutatorListItem_(rootNode, 'Add argument', block => {
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

      block.arguments_.push(argname);
      block.updateParams_();
      this.listItemOnclick(rootNode);
    }));

    block.arguments_.forEach(arg => {
      var elem = Blockly.Linearization.makeListTextItem_(
        'Argument \"' + arg + '\"');
      elem.contentEditable = true;
      elem.addEventListener('focus', (e) => elem.innerText = arg);
      elem.addEventListener('blur', (event) => {
        if (elem.innerText === "") {
          block.arguments_.splice(block.arguments_.indexOf(arg), 1);
          block.updateParams_();
          listItemOnclick(rootNode);
        } else {
          block.arguments_.splice(
            block.arguments_.indexOf(arg), 1, elem.innerText);
          block.updateParams_();
        }
      });

      list.push(elem);
    })
  }

  return list;
}

/**
 * Returns an html list item that encodes the mutator option defined by text,
 * with source node rootNode, and onclick listener innerFn that accepts
 * rootNode.getLocation(). (listItemOnclick(rootNode) is performed
 * automatically.)
 * @param {!Blockly.ASTNode} rootNode node containing the block with mutator
 * @param {!string} text option text
 * @param {!function(Blockly.Block)} additional onclick listener that accepts
 * rootNode.getLocation()
 * @return {HTMLElement} an html list item encoding the mutator option defined
 * by rootNode and text, with onclick behavior innerFn(rootNode.getLocation())
 * @private
 */
Blockly.Linearization.prototype.makeMutatorListItem_ = function(rootNode, text,
    innerFn) {
  var block = rootNode.getLocation();
  var elem = Blockly.Linearization.makeListTextItem_(text);
  elem.addEventListener('click', e => {
    innerFn(block);
    this.listItemOnclick(rootNode);
  })
  return elem;
}

/**
 * Returns the appropriate html list item for the connection,
 * attempting to validate the connection if such a connection is possible
 * @param {!Blockly.ASTNode} rootNode the current selectedNode from which
 * candidate is being collected
 * @param {!Blockly.ASTNode} candidate the item to validate for completing the
 * connection in this.blockJoiner, a child node of rootNode
 * @param {!string} text the text stub which describes the nature of the action
 * this item represents if the connection to candidate is valid
 * @param {!string} alttext the text stub which describes the nature of the action
 * this item represents if the connection to candidate is not valid
 * @return {HTMLElement} the appropriate html element to represent this
 * potential connection
 * @private
 */
Blockly.Linearization.prototype.makeConnListItem_ = function(rootNode,
    candidate, text, alttext) {
  var connNode = this.blockJoiner.connectionNode;
  if (!connNode) {
      return this.makeBasicConnListItem_(candidate, alttext);
  }

  var conn = connNode.getLocation();
  var check = conn.canConnectWithReason_(candidate.getLocation());
  if (check === Blockly.Connection.CAN_CONNECT) {
    var label = text + ' ' + conn.getSourceBlock().makeAriaLabel();
    return this.makeBasicConnListItem_(rootNode, label);
  } else if (check === Blockly.Connection.REASON_SELF_CONNECTION) {
    var item = Blockly.Linearization.makeListTextItem_('Cancel insert');
    item.addEventListener('click', e => {
      this.blockJoiner.connectionNode = null;
      this.generateList_();
    });
    return item;
  }

  return this.makeBasicConnListItem_(candidate, alttext);
}

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
Blockly.Linearization.prototype.makeBasicConnListItem_ = function(node, text) {
  var item = Blockly.Linearization.makeListTextItem_(text);
  var connection = node.getLocation();
  item.id = "li" + connection.id;
  item.blockId = connection.id;
  item.setAttribute('style', 'color:hsl(0, 0%, 0%)');
  item.addEventListener('click', e => this.moveItemOnclick(node, e));
  return item;
}

/**
 * Creates and returns the color-coded, linked HTML bold text of a parent block
 * used in parent-nav.
 * @param {?Blockly.ASTNode=} node undefined by default, a parent node. If null,
 * creates the workspace ParentItem.
 * @return {HTMLElement} an html representation of node as a parent
 * @private
 */
Blockly.Linearization.prototype.makeParentItem_ = function(node=undefined) {
  var item = document.createElement('b');
  var labelText = Blockly.Linearization.getNodeLabel(node);
  if (!node && !this.selectedNode) {
    labelText += this.blockJoiner.blockNode? ' (move mode)': ' (summary)';
  }
  item.appendChild(document.createTextNode(labelText + ' > '));
  if (node) {
    item.setAttribute('style',
          'color:hsl(' + node.getLocation().getHue() + ', 40%, 40%)');
  }
  item.setAttribute('aria-label', 'Jump to ' + labelText);
  item.addEventListener('click', e => this.listItemOnclick(node));
  return item;
}

/**
 * Creates and returns the appropriately edittable HTML ListElement of node.
 * @param {!Blockly.ASTNode} node the input/field to represent
 * @return {HTMLElement} an edittable html representation of node
 * @private
 */
Blockly.Linearization.prototype.makeInputListItem_ = function(node) {
  var location = node.getLocation();
  switch (node.getType()) {
    case Blockly.ASTNode.types.FIELD:
      if (location instanceof Blockly.FieldDropdown) {
        return this.makeDropdownItem_(location);
      }
      if (location instanceof Blockly.FieldNumber
          || location instanceof Blockly.FieldTextInput) {
        return this.makeEditableFieldItem_(location);
      }
      var fallthroughText = 'field but neither dropdown nor number';
      return Blockly.Linearization.makeListTextItem_(fallthroughText);
    case Blockly.ASTNode.types.INPUT:
      if (location.targetConnection) {
        var targetInputs = location.targetConnection.getSourceBlock().inputList;
        if (targetInputs.length === 1 &&
            (targetInputs[0].fieldRow[0] instanceof Blockly.FieldNumber)) {
          return this.makeEditableFieldItem_(targetInputs[0]);
        }
        var targetBlockNode = node.in().next();
        return this.makeBasicListItem_(targetBlockNode);
      }
      break;
    case Blockly.ASTNode.types.OUTPUT:
      break;
    default: // should never happen
      console.warn('uncaught', node);
      break;
  }
  return null;
}

/**
 * Returns an ordered Array of linked html list items that represent the
 * movement options of the node and the node itself
 * @param {!Blockly.ASTNode} node the node to represent
 * @return {Array<HTMLElement>} the html representation of node and its options
 * @private
 */
Blockly.Linearization.prototype.makeNodeListItems_ = function(node) {
  var list = [];

  var disp = this.blockJoiner.blockNode !== node && this.blockJoiner.blockNode;
  var prevConn = node.prev();
  var dispPrev = prevConn && !prevConn.prev();
  if (disp && dispPrev) {
    try {
      prevConn.getLocation().checkConnection_(
        this.blockJoiner.blockNode.next().getLocation());
      list.push(this.makeBasicConnListItem_(prevConn, 'Insert above'));
    } catch (e) { /* invalid connection point */ }
  }

  list.push(this.makeBasicListItem_(node));

  var nextConn = node.next();
  if (disp && nextConn) {
    try {
      nextConn.getLocation().checkConnection_(
        this.blockJoiner.blockNode.prev().getLocation());
      var last = !nextConn.next() ||
          nextConn.next().getType() !== Blockly.ASTNode.types.PREVIOUS;
      var text = last? 'Insert below': 'Insert between';
      list.push(this.makeBasicConnListItem_(node.next(), text));
    } catch (e) { /* invalid connection point */ }
  }

  return list;
}

/**
 * Returns an ordered Array of linked html list items that represent the
 * list of branches on the if block the node contain
 * @param {!Blockly.ASTNode} node the node containing an if block to represent
 * @return {Array<HTMLElement>} the html representation of node and its branches
 * @private
 */
Blockly.Linearization.prototype.makeIfListItems_ = function(node) {
  var list = [];
  const inputs = node.getLocation().inputList;
  const children = node.in().sequence(n => n.next());
  const blankText = 'blank', elseText = 'else ';

  for (var i = 0; i < inputs.length; i += 2) {
    var cond, do_input, mode, condConnNode, doConnNode;
    if (i == inputs.length - 1) {
      do_input = inputs[i].connection.targetBlock();
      doConnNode = children[i];
      condConnNode = null;
      mode = elseText;
    } else {
      cond = inputs[i].connection.targetBlock();
      condConnNode = children[i];
      do_input = inputs[i + 1].connection.targetBlock();
      doConnNode = children[i + 1];
      mode = (i > 0? elseText: '') + 'if ';
    }

    var text = mode;
    if (mode !== elseText) {
      text += cond? cond.makeAriaLabel(): blankText;
      text += ' then';
    }

    var bracketItem;
    if (condConnNode && condConnNode.in() && condConnNode.in().next()) {
      bracketItem = this.makeBasicListItem_(condConnNode.in().next());
      bracketItem.innerHTML = text;
    } else {
      try {
        condConnNode.getLocation().checkConnection_(
          this.blockJoiner.blockNode.next().getLocation());
          bracketItem = this.makeBasicConnListItem_(condConnNode);
          bracketItem.innerHTML = text + ' (click to fill blank)';
        } catch(e) {
          console.log(e);
          bracketItem = Blockly.Linearization.makeListTextItem_(text);
        }
    }

    var bracketItemList = document.createElement('ul');
    bracketItem.appendChild(bracketItemList);
    list.push(bracketItem);

    if (!do_input) {
      bracketItemList.appendChild(
        this.makeBasicConnListItem_(doConnNode, 'Insert within ' + text));
      continue;
    }

    var firstNode = Blockly.ASTNode.createBlockNode(do_input);
    if (firstNode.getType() !== Blockly.ASTNode.types.BLOCK) {
      firstNode = firstNode.getFirstSiblingBlock();
    }

    firstNode.sequence(n => n.getFirstSiblingBlock())
      .map(node => this.makeNodeListItems_(node))
      .forEach(items => bracketItemList.append(...items));
  }

  return list;
}

/**
 * Creates and returns the standard ListElement for the block in node, labelled
 * with text equivalent to node.getLocation().makeAriaLabel().
 * Attributes include a unique id and blockId for the associated block, as well
 * adding the standard listItemOnclick(node) event listener on click.
 * @param {!Blockly.ASTNode} node the block to represent
 * @return {HTMLElement} an linked html list item representation of node
 * @private
 */
Blockly.Linearization.prototype.makeBasicListItem_ = function(node) {
  var listElem = document.createElement('li');
  var block = node.getLocation();
  var text = block.makeAriaLabel();
  if (this.blockJoiner.blockIs(node)) {
    text += ' (moving me...)';
  }
  listElem.id = "li" + block.id;
  listElem.blockId = block.id;
  listElem.appendChild(document.createTextNode(text));
  listElem.addEventListener('click', e => this.listItemOnclick(node));
  listElem.setAttribute('style',
          'color:hsl(' + node.getLocation().getHue() + ', 40%, 40%)');
  return listElem;
}

/**
 * Creates and returns a textfield HTML li element linked to node's value.
 * @param {!Blockly.ASTNode} node the field or input to represent
 * @return {HTMLElement} an html list item that is edittable for number
 * and text fields.
 * @private
 */
Blockly.Linearization.prototype.makeEditableFieldItem_ = function(node) {
  var listElem;
  try {
    var field = node.fieldRow[0];
  } catch {
    var field = node;
  }
  if (field instanceof Blockly.FieldDropdown) {
    return this.makeDropdownItem_(field)
  }
  var fieldName = field.name;
  if (field.getText() === "") {
    listElem = Blockly.Linearization.makeListTextItem_('[Enter some text]');
  } else {
    listElem = Blockly.Linearization.makeListTextItem_(field.getText());
  }
  listElem.id = "li" + field.getSourceBlock().id;
  listElem.contentEditable = true;
  listElem.addEventListener('blur', function(event) {
    var block = workspace.getBlockById(listElem.id.slice(2));
    block.setFieldValue(listElem.innerText, fieldName);
  });
  listElem.addEventListener('keyup', (event) => {
    event.preventDefault();
    if (event.keyCode === 13) {
      var block = this.workspace.getBlockById(listElem.id.slice(2));
      block.setFieldValue(listElem.innerText, fieldName);
    }
  });
  return listElem;
}

/**
 * Returns the html list element representing field, null if an invalid field
 * @param {!Blockly.FieldDropdown} field the field to represent
 * @return {?HTMLElement} a clickable representation of the field that toggles
 * options through the dropdown option list. If there are no options, null.
 */
Blockly.Linearization.prototype.makeDropdownItem_ = function(field) {
  var options = field.getOptions();
  if (!options.length) {
    return null;
  }


  const makeOptObj = (option) => ({label: option[0], value: option[1]});
  const makeEntryObj = (i) => ({i: i, option: makeOptObj(options[i])});

  var entry = makeEntryObj(0);
  for (var i = 0, option; option = options[i]; i++) {
    if (option[1] === field.getValue()) {
      entry = makeEntryObj(i);
      break;
    }
  }

  var labelText = 'Field: ' + entry.option.label;
  var elem = Blockly.Linearization.makeListTextItem_(labelText);
  elem.setAttribute('aria-label', labelText + ', click to change');
  elem.setAttribute('index', entry.i);
  elem.addEventListener('click', e => {
    Blockly.Events.disable();
    var offset = 1;
    while (offset < field.getOptions().length) {
      var newIndex = (parseInt(elem.getAttribute('index')) + offset)
          % field.getOptions().length;
      var option = makeOptObj(field.getOptions()[newIndex]);
      var newLabelText = 'Field: ' + option.label;
      var textNode = document.createTextNode(newLabelText);
      elem.setAttribute('aria-label', newLabelText + ', click to change');
      elem.setAttribute('index', newIndex);

      try {
        field.setValue(option.value);
        elem.replaceChild(textNode, elem.firstChild);
        break;
      } catch (e) { // not a variable, so value can't be set
        console.warn('not a valid variable', option);
      }
    }
    this.generateParentNav_(this.selectedNode);
    Blockly.Events.enable();
  });
  return elem;
}

/**
 * Creates and returns a linked HTML li element linked to node's direct visual
 * parent.
 * @param {!Blockly.ASTNode} node the child node of the parent to go back to
 * @return {HTMLElement} an html list item that will navigate to the direct
 * visual parent block
 */
Blockly.Linearization.prototype.makeGoBackItem_ = function(node) {
  var returnNode = document.createElement('li');
  var outNode = node.out();
  while (outNode && outNode.getType() !== 'block') {
    outNode = outNode.out();
  }
  var labelText = 'Go back to ' + Blockly.Linearization.getNodeLabel(outNode);
  returnNode.appendChild(document.createTextNode(labelText));
  returnNode.addEventListener('click', e => this.listItemOnclick(outNode));
  return returnNode;
}

/**
 * Creates and returns an li element that pushes the node to this.blockJoiner
 * on click
 * @param {!Blockly.ASTNode} node the node to be moved on click
 * @return {HTMLElement} a labeled html list item that will fire
 * this.moveItemOnclick(node) when clicked.
 */
Blockly.Linearization.prototype.makeMoveItem_ = function(node) {
  var text = this.blockJoiner.blockNode? 'Move me instead': 'Move me';
  var element = Blockly.Linearization.makeListTextItem_(text);
  element.addEventListener('click', e => this.moveItemOnclick(node, e));
  return element;
}

/**
 * Pushes the node to this.blockJoiner, and navigates to the workspace level
 * linearization
 * @param {!Blockly.ASTNode} node the node to be pushed
 */
Blockly.Linearization.prototype.moveItemOnclick = function(node, e) {
  try {
    this.blockJoiner.push(node);
    this.selectedNode = null;
    this.generateList_();
  } catch (e) {
    console.warn('Unsuccessful push', e);
  }
}

/**
 * The standard onclick action for ListElements. Highlights the node's block if
 * node is not null, sets the selectedNode to node, and calls generateList_().
 * @param {?Blockly.ASTNode} node the node to navigate to and highlight
 */
Blockly.Linearization.prototype.listItemOnclick = function(node) {
  this.highlightBlock(node && node.getLocation());
  this.selectedNode = node;
  this.generateList_();
}

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
}

/**
 * Unhighlights lastHighlighted, if lastHighlighted is not null.
 */
Blockly.Linearization.prototype.clearHighlighted = function() {
  if (this.lastHighlighted) {
    this.lastHighlighted.setHighlighted(false);
  }
}

/**
 * Creates and returns an HTML li element with a text node reading text.
 * @param {!String} text the text on the list item
 * @return {HTMLElement} an html list item with text node text
 * @private
 */
Blockly.Linearization.makeListTextItem_ = function(text) {
    var listElem = document.createElement('li');
    listElem.appendChild(document.createTextNode(text));
    return listElem;
  }

/**
 * Creates and returns the next label in lexicographic order, adding a letter in
 * the event of overflow.
 * @param {!String} marker the last node created
 * @return {String} the next label after marker in lexicographic order
 */
Blockly.Linearization.nextStackMarker = function(marker) {
  var lastIndex = marker.length - 1;
  var prefix = marker.slice(0, lastIndex);
  if (marker.charCodeAt(lastIndex) === 'Z'.charCodeAt(0)) {
    return (prefix? this.nextStackMarker(prefix): 'A') + 'A';
  }
  return prefix + String.fromCharCode(marker.charCodeAt(lastIndex) + 1);
}

/**
 * Creates and returns the aria label for node if
 * node.getLocation().makeAriaLabel is not null, 'workspace' if otherwise.
 * @param {?Blockly.ASTNode} node the node to get aria-label from
 * @return {String} the string generated by node.getLocation().makeAriaLabel()
 */
Blockly.Linearization.getNodeLabel = function(node) {
  return node && node.getLocation().makeAriaLabel?
      node.getLocation().makeAriaLabel(): 'workspace';
}

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
}

// function getValidConnections(block) {
//   var ws = Blockly.getMainWorkspace();
//   var nodes = getAllValidNodesForBlock(block);
//   var connectionList = [];
//   for (var i = 0, node; node = nodes[i]; i++) {
//     if (node.isConnection  ()) {
//       var nodeBlock = node.getLocation().getSourceBlock();
//       var nodeConnection = node.getLocation();
//       if (!(block.getDescendants().includes(nodeBlock))) {
//         // TODO: don't use a private function here
//         for (var connection of block.getConnections_(false)) {
//           if (connection.isConnectionAllowed(nodeConnection) &&
//             (connection.targetConnection !== nodeConnection)) {
//             connectionList.push(connection);
//           }
//         }
//       }
//     }
//   }
//   return connectionList;
// }
//
// function getAllValidNodesForBlock(block) {
//  var ws = Blockly.getMainWorkspace();
//  var defaultCoord = new goog.math.Coordinate(100,100);
//  var curNode = Blockly.ASTNode.createWorkspaceNode(ws, defaultCoord);
//  var nodes = [];
//  do {
//    nodes.push(curNode);
//    curNode = treeTraversal(curNode, block);
//  } while (curNode);
//  return nodes;
// }
//
// Unused code
//
// /**
//  * Returns all blocks in the main workspace encapsulated in nodes.
//  * @return {Array<Blockly.ASTNode>} all possible nodes from the main workspace
//  */
// function getAllNodes() {
//     var ws = Blockly.getMainWorkspace();
//     var curNode = Blockly.ASTNode.createWorkspaceNode(ws, new goog.math.Coordinate(100,100));
//     var nodes = [];
//     do {
//       nodes.push(curNode);
//       curNode = treeTraversal(curNode);
//     } while (curNode);
//     return nodes;
// }
//
// /**
//  * Decides what nodes to traverse and which ones to skip. Currently, it
//  * skips output, stack and workspace nodes.
//  * @param {Blockly.ASTNode} node The ast node to check whether it is valid.
//  * @return {Boolean} True if the node should be visited, false otherwise.
//  * @package
//  */
// function validNode(node) {
//   var isValid = false;
//   if (node && (node.getType() === Blockly.ASTNode.types.BLOCK
//     || node.getType() === Blockly.ASTNode.types.INPUT
//     || node.getType() === Blockly.ASTNode.types.FIELD
//     || node.getType() === Blockly.ASTNode.types.NEXT
//     || node.getType() === Blockly.ASTNode.types.PREVIOUS)) {
//       isValid = true;
//   }
//   return isValid;
// }
//
// /**
//  * From the given node find either the next valid sibling or parent.
//  * @param {Blockly.ASTNode} node The current position in the ast.
//  * @return {Blockly.ASTNode} The parent ast node or null if there are no
//  * valid parents.
//  * @package
//  */
// function findSiblingOrParent(node) {
//   if (!node) {
//     return null;
//   }
//   var nextNode = node.next();
//   if (nextNode) {
//     return nextNode;
//   }
//   return findSiblingOrParent(node.out());
// }
//
// /**
//  * Uses pre order traversal to go navigate the blockly ast. This will allow
//  * a user to easily navigate the entire blockly AST without having to go in
//  * and out levels on the tree.
//  * @param {Blockly.ASTNode} node The current position in the ast.
//  * @return {Blockly.ASTNode} The next node in the traversal.
//  * @package
//  */
// function treeTraversal(node, takeNode=validNode) {
//   if (!node) {
//     return null;
//   }
//   var newNode = node.in() || node.next();
//   if (takeNode(newNode)) {
//     return newNode;
//   } else if (newNode) {
//     return treeTraversal(newNode, takeNode);
//   } else {
//     var siblingOrParent = findSiblingOrParent(node);
//     if (takeNode(siblingOrParent)) {
//       return siblingOrParent;
//     } else if (siblingOrParent
//       && siblingOrParent.getType() !== Blockly.ASTNode.types.WORKSPACE) {
//       return treeTraversal(siblingOrParent, takeNode);
//     }
//   }
// }
// /**
//  * Finds the next node in the tree traversal starting at the location of
//  * the cursor.
//  * @return {Blockly.ASTNode} The next node in the traversal.
//  * @package
//  */
// function findNext() {
//     var cursor = Blockly.Navigation.cursor_;
//     var curNode = cursor.getCurNode();
//     return treeTraversal(curNode);
// }
