/**
 * @fileoverview The class for generating accessible linearization
 * of a workspace, and a helper classes
 */

/**
* Class to manage requests for blocks from connections, and vice-versa.
* Allows for a single connection request and a single block request at a time.
*/
class BlockJoiner {
  /**
  * Attempt to fill the request for this item. item must be Blockly.Block or
  * Blockly.Connection.
  * @param {Block.ASTNode} item
  * @return {boolean} true if successfully pushed, false if request fails
  */
  push = (item) => {
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
  service_ = () => {
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
        console.log({warn:'fell through', insertPointNode});
        return;
    }

    // Get the previous connection, disallow fields
    var previous = advance(insertPointNode);
    if (previous && previous.getType() === Blockly.ASTNode.types.FIELD) {
      previous = null;
    }

    // connect this.blockNode and this.connectionNode
    var provided = this.blockNode;
    var providedBlock = back(provided).getLocation();
    insertPointNode.getLocation().connect(providedBlock);

    // restich any cuts made by connecting the nodes
    // if (previous && previous.getLocation) {
    //   var sutureNode = advance(provided);
    //   if (sutureNode && sutureNode.getLocation) {
    //     try {
    //       previous.getLocation().connect(sutureNode.getLocation())
    //     } catch(e) {
    //       console.log('suture failed...');
    //       console.log(e);
    //     }
    //   }
    // }

    // clear the values
    this.connectionNode = null;
    this.blockNode = null;
  }
}

/**
 * Class for generating the linearization of a workspace, displayed in
 * parent nav and mainNavList.
 */
class Linearization {
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
  constructor(workspace, parentNav, mainNavList) {
    this.workspace = workspace;
    this.parentNav = parentNav;
    this.mainNavList = mainNavList;
    this.blockJoiner = new BlockJoiner();
    this.mode = this.SelectionMode.VIEW;
    workspace.addChangeListener(this.generateList_);
  }


  /**
   * Selection Modes
   * @enum {string}
   */
  SelectionMode = {
    VIEW: 'View',
    EDIT: 'Edit'
  }

  /**
 * The ChangeListener for workspace events. On fire, fully redraws
 * linearization, including parentNav.
 * @param {?Blockly.Events.Abstract=} e undefined by default, the workspace
 * event that triggers this ChangeListener.
 * @private
 */
  generateList_ = (e=undefined) => {
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
  alterSelectedWithEvent_ = (e) => {
    var workspace = this.workspace;
    var node;
    switch (e.type) {
      case Blockly.Events.BLOCK_MOVE:
        var block = workspace.getBlockById(e.blockId);
        node = block && Blockly.ASTNode.createBlockNode(block);
        if (block && this.blockJoiner.connectionNode) {
          try {
            this.blockJoiner.push(node);
          } catch(e) {
            this.blockJoiner.blockNode = null;
          }
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
  generateParentNav_ = (rootNode) => {
    var pNav = this.parentNav;
    pNav.innerHTML = '';
    pNav.appendChild(this.makeParentItem_());

    if (rootNode) {
      rootNode.getParentStack(true)
          .filter(node => node.getType() === Blockly.ASTNode.types.BLOCK)
          .reverse()
          .map(this.makeParentItem_)
          .forEach(elem => pNav.appendChild(elem));
    }

    if (this.blockJoiner.connectionNode) {
      pNav.appendChild(document.createElement('br'));
      var cancelItem = document.createElement('b');
      cancelItem.appendChild(document.createTextNode('Cancel Move'));
      cancelItem.addEventListener('click', e => {
          this.blockJoiner.connectionNode = null;
          this.generateList_();
      });
      pNav.appendChild(cancelItem);
    }

    var modeItem = document.createElement('b');
    modeItem.appendChild(document.createTextNode('Mode: ' + this.mode));
    modeItem.addEventListener('click', e => {
      this.mode = this.mode === this.SelectionMode.VIEW?
          this.SelectionMode.EDIT: this.SelectionMode.VIEW;
      this.generateList_();
    });
    pNav.appendChild(document.createElement('br'));
    pNav.appendChild(modeItem);
  }

/**
 * Creates and returns the HTML unordered list of labelled stacks with sublists
 * of every block on the same visual indent, represented with list elements
 * @param {!Blockly.Workspace} Current workspace
 * @return {HTMLElement} an html representation of the top level of the current
 * workspace, in the form of an unordered list.
 * @private
 */
  makeWorkspaceList_ = () => {
    var workspace = this.workspace;
    var wsNode = Blockly.ASTNode.createWorkspaceNode(workspace);
    var wsList = document.createElement('ul');

    // for each stack
    var firstStack = wsNode.in();
    var marker = 'A';
    firstStack.sequence(n => n.next()).forEach(stack => {
      var stackItem = document.createElement('li');
      stackItem.appendChild(document.createTextNode('Stack ' + marker));
      marker = Linearization.nextStackMarker(marker);
      var stackItemList = document.createElement('ul');

      // for each block node in the top of the stack
      var firstNode = stack.in();
      if (firstNode.getType() !== Blockly.ASTNode.types.BLOCK) {
        firstNode = firstNode.getFirstSiblingBlock();
      }
      // add a new list element representing the block to the list
      firstNode.sequence(n => n.getFirstSiblingBlock())
        .map(this.makeBasicListElement_)
        .forEach(node => stackItemList.appendChild(node));

      stackItem.appendChild(stackItemList);
      wsList.appendChild(stackItem);
    });

    return wsList;
  }

  /**
 * Creates and returns the HTML unordered list of every block on the same visual
 * indent within the rootNode, represented with list elements
 * @param {!Blockly.ASTNode} rootNode the direct parent of all items in the list
 * @return {HTMLElement} an html representation of the top level of the
 * rootNode, in the form of an unordered list.
 * @private
 */
  makeNodeList_ = (rootNode) => {
    var sublist = document.createElement('ul');
    sublist.appendChild(this.makeGoBackElement_(rootNode));

    var connNode = this.blockJoiner.connectionNode;
    var inlineOutputConn = connNode && connNode.getParentInput() &&
        connNode.getParentInput().type === Blockly.INPUT_VALUE;


    var prevConn = rootNode.prev();
    if (this.mode === this.SelectionMode.EDIT && prevConn) {
      // sublist.appendChild(this.makeConnListItem_(rootNode, prevConn,
      //     inlineOutputConn? 'XX Tack me on side of': 'XX Insert me below',
      //     'XX Insert above me'));
    }

    var inline = rootNode.getFirstInlineBlock();
    if (inline) {
      var inlineSeq = inline.sequence(Linearization.nextInlineInput);
      inlineSeq.map(this.makeInputListElement_)
        .filter(n => n)
        .forEach(elem => sublist.appendChild(elem));
    }

    var inNode = rootNode.in();
    while (inNode && inNode.getType() !== Blockly.ASTNode.types.INPUT) {
      inNode = inNode.next();
    }

    if (this.mode === this.SelectionMode.EDIT && !connNode && inNode) {
      sublist.append(...this.makeAllInnerInputElements_(inNode));
    }

    if (this.mode === this.SelectionMode.EDIT && rootNode.getLocation().mutator) {
      sublist.append(...this.makeAllMutatorElements_(rootNode));
    }

    var firstNested = rootNode.getFirstNestedBlock();
    if (firstNested) {
      firstNested.sequence(n => n.getFirstSiblingBlock())
          .map(this.makeNodeListElements_)
          .forEach(elems => sublist.append(...elems));
      // if last child allows next connection
    }

    var nextConn = rootNode.next();
    if (this.mode === this.SelectionMode.EDIT && nextConn) {
      // sublist.appendChild(this.makeConnListItem_(rootNode, nextConn,
      //   inlineOutputConn? 'XX Tack me on side of': 'XX Insert me above',
      //   'XX Insert below me'));
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
  makeAllInnerInputElements_ = (inNode) => {
    var inNodeSeq = inNode.sequence(n => n.next()).filter(n => n);
    var counter = { // used mainly for if/elseif/else statements
      tackVal: 1,
      insertVal: 1,
      tackText: () => (inNodeSeq.length == 1)? '': ' ' + counter.tackVal++,
      insertText: () => (inNodeSeq.length == 1)? '':' ' + counter.insertVal++
    }
    var use = n.getParentInput() && n.getParentInput().type === Blockly.INPUT_VALUE;
    if (!use) {
      return [];
    }
    return inNodeSeq.map(
      n => this.makeBasicConnListItem_(n, 'Insert within' + counter.insertText()));
  }

  /**
 * Returns all mutator options for the block rootNode wraps in an array.
 * @param {!Blockly.ASTNode} rootNode node containing the block with mutator
 * @return {Array<HTMLElement>} an array containing all mutator options encoded
 * as html list items.
 */
  makeAllMutatorElements_ = (rootNode) => {
    var block = rootNode.getLocation();
    var list = [];

    if (block.elseifCount_ != undefined) {
      list.push(this.makeMutatorListElement(rootNode, 'Add elseif', block => {
        block.elseifCount_++;
        block.rebuildShape_();
      }));

      if (block.elseifCount_ > 0) {
        list.push(this.makeMutatorListElement(rootNode, 'Remove elseif',
        block => {
          block.elseifCount_--;
          block.rebuildShape_();
        }));
      }
    }

    if (block.elseCount_ === 0) {
      list.push(this.makeMutatorListElement(rootNode, 'Add else', block => {
        block.elseCount_++;
        block.rebuildShape_();
      }));
    } else if (block.elseCount_ === 1) {
      list.push(this.makeMutatorListElement(rootNode, 'Remove else', block => {
        block.elseCount_--;
        block.rebuildShape_();
      }));
    }

    if (block.itemCount_ != undefined) {
      list.push(this.makeMutatorListElement(rootNode, 'Add item', block => {
        block.itemCount_++;
        block.updateShape_();
      }));

      if (block.itemCount_ > 1) {
        list.push(this.makeMutatorListElement(rootNode, 'Remove item', block => {
          block.itemCount_--;
          block.updateShape_();
        }));
      }
    }

    if (block.arguments_ != undefined) {
      list.push(this.makeMutatorListElement(rootNode, 'Add argument', block => {
        var argname;
        if (block.arguments_.length) {
          var lastArg = block.arguments_[block.arguments_.length - 1];
          argname = (lastArg.length > 5)? lastArg:
            Linearization.nextStackMarker(lastArg);
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
        var elem = Linearization.makeListTextElement(
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
 */
  makeMutatorListElement = (rootNode, text, innerFn) => {
  var block = rootNode.getLocation();
  var elem = Linearization.makeListTextElement(text);
  elem.addEventListener('click', e => {
    innerFn(block);
    this.listItemOnclick(rootNode);
  })
  return elem;
}

  // TODO: write documentation
  makeConnListItem_ = (rootNode, candidate, text, alttext) => {
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
    var item = Linearization.makeListTextElement('Cancel insert');
    item.addEventListener('click', e => {
      this.blockJoiner.connectionNode = null;
      this.generateList_();
    });
    return item;
  }

  return this.makeBasicConnListItem_(candidate, alttext);
}

  // TODO: write documentation
  makeBasicConnListItem_ = (node, text) => {
    var item = Linearization.makeListTextElement(text);
    var connection = node.getLocation();
    item.id = "li" + connection.id;
    item.blockId = connection.id;
    item.addEventListener('click', e => {
      this.blockJoiner.push(node);
      this.selectedNode = null;
      this.generateList_();
    });
    return item;
  }

  /**
 * Creates and returns the color-coded, linked HTML bold text of a parent block
 * used in parent-nav.
 * @param {?Blockly.ASTNode=} node undefined by default, a parent node. If null,
 * creates the workspace ParentItem.
 * @return {HTMLElement} an html representation of node as a parent
 */
  makeParentItem_ = (node=undefined) => {
    var item = document.createElement('b');
    var labelText = Linearization.getNodeLabel(node);
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
 */
  makeInputListElement_ = (node) => {
    var location = node.getLocation();
    switch (node.getType()) {
      case Blockly.ASTNode.types.FIELD:
        if (location instanceof Blockly.FieldDropdown) {
          return this.makeDropdownElement_(location);
        } else if (location instanceof Blockly.FieldNumber || location instanceof Blockly.FieldTextInput) {
          return this.makeEdittableFieldElement_(location);
        } else {
          return Linearization.makeListTextElement('field but neither dropdown nor number');
        }
      case Blockly.ASTNode.types.INPUT:
        if (location.targetConnection) {
          var targetInputs = location.targetConnection.getSourceBlock().inputList;
          if (targetInputs.length === 1 && (targetInputs[0].fieldRow[0] instanceof Blockly.FieldNumber)) {
            return this.makeEdittableFieldElement_(targetInputs[0]);
          }
          var targetBlockNode = node.in().next();
          return this.makeBasicListElement_(targetBlockNode);
        }
        return Linearization.makeListTextElement('add block inline');
      case Blockly.ASTNode.types.OUTPUT:
        break;
      default:
        console.log('uncaught');
        console.log(node);
        break;
    }
    return null;
  }

  makeNodeListElements_ = (node) => {
    var list = [];
    var displayConn = this.mode === this.SelectionMode.EDIT;
    if (displayConn && node.prev().getType() === Blockly.ASTNode.types.PREVIOUS) {
      var text = node.prev().prev().getType() === Blockly.ASTNode.types.NEXT?
              'Insert between': 'Insert above';
      list.push(this.makeBasicConnListItem_(node, text));
    }

    list.push(this.makeBasicListElement_(node));
    var nextPrevConn = node.next().next();

    if (displayConn && !nextPrevConn &&
        node.next().getType() === Blockly.ASTNode.types.NEXT) {
      list.push(this.makeBasicConnListItem_(node, 'Insert below'));
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
  makeBasicListElement_ = (node) => {
    var listElem = document.createElement('li');
    var block = node.getLocation();
    listElem.id = "li" + block.id;
    listElem.blockId = block.id;
    listElem.appendChild(document.createTextNode(block.makeAriaLabel()));
    listElem.addEventListener('click', e => this.listItemOnclick(node));
    listElem.setAttribute('style',
            'color:hsl(' + node.getLocation().getHue() + ', 40%, 40%)');
    return listElem;
  }

  /**
 * Creates and returns a textfield HTML li element linked to node's value.
 * @param {!Blockly.ASTNode} node the node of type field or input containing the item to represent
 * @return {HTMLElement} an html list item that is edittable for number
 * and text fields.
 * @private
 */
  makeEdittableFieldElement_ = (node) => {
    var listElem;
    try {
      var field = node.fieldRow[0];
    } catch {
      var field = node;
    }
    if (field instanceof Blockly.FieldDropdown) {
      return this.makeDropdownElement_(field)
    }
    var fieldName = field.name;
    if (field.getText() === "") {
      listElem = Linearization.makeListTextElement('[Enter some text]');
    } else {
      listElem = Linearization.makeListTextElement(field.getText());
    }
    listElem.id = "li" + field.getSourceBlock().id;
    listElem.contentEditable = true;
    listElem.addEventListener('blur', function(event) {
      var block = workspace.getBlockById(listElem.id.slice(2));
      block.setFieldValue(listElem.innerText, fieldName);
    });
    return listElem;
  }

  // TODO: fix me! write docs
  makeDropdownElement_ = (field) => {
    var options = field.getOptions();
    if (!options.length) {
      return null;
    }
    var entry;
    for (var i = 0, option; option = options[i]; i++) {
      if (option[1] === field.getValue()) {
        entry = [i, option];
      }
    }
    if (!entry) {
      entry = [0, field.getOptions()[0]];
    }
    var elem = Linearization.makeListTextElement('Field: ' + entry[1][0]);
    elem.setAttribute('aria-label', 'Field: ' + entry[1][0] + ', click to change');
    elem.setAttribute('index', entry[0]);
    elem.addEventListener('click', e => {
      var newIndex = (parseInt(elem.getAttribute('index')) + 1)
          % field.getOptions().length;
      var option = field.getOptions()[newIndex];
      var textNode = document.createTextNode('Field: ' + option[0]);
      elem.setAttribute('aria-label', 'Field: ' + option[0] + ', click to change');
      elem.replaceChild(textNode, elem.firstChild);
      elem.setAttribute('index', newIndex);
      Blockly.Events.disable();
      // TODO: fix me, so very sad
      try {
        field.setValue(option[1]);
        this.generateParentNav_(this.selectedNode);
      } catch (e) {

      } finally {
        Blockly.Events.enable();
      }
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
  makeGoBackElement_ = (node) => {
    var returnNode = document.createElement('li');
    var outNode = node.out();
    while (outNode && outNode.getType() !== 'block') {
      outNode = outNode.out();
    }
    var labelText = 'Go back to ' + Linearization.getNodeLabel(outNode);
    returnNode.appendChild(document.createTextNode(labelText));
    returnNode.addEventListener('click', e => this.listItemOnclick(outNode));
    return returnNode;
  }

  /**
 * The standard onclick action for ListElements. Highlights the node's block if
 * node is not null, sets the selectedNode to node, and calls generateList_().
 * @param {?Blockly.ASTNode} node the node to navigate to and highlight
 */
  listItemOnclick = (node) => {
    this.highlightBlock(node && node.getLocation());
    this.selectedNode = node;
    this.generateList_();
  }

  /**
 * Highlights block if block is not null. Sets lastHighlighted to block.
 * @param {?Blockly.ASTNode} block block to highlight, null if none
 */
  highlightBlock = (block) => {
  this.clearHighlighted();
  if (block) {
    block.setHighlighted(true);
  }
  this.lastHighlighted = block;
}

  /**
 * Unhighlights lastHighlighted, if lastHighlighted is not null.
 */
  clearHighlighted = () => {
  if (this.lastHighlighted) {
    this.lastHighlighted.setHighlighted(false);
  }
}

  /**
 * Creates and returns an HTML li element with a text node reading text.
 * @param {!String} text the text on the list item
 * @return {HTMLElement} an html list item with text node text
 */
  static makeListTextElement(text) {
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
  static nextStackMarker(marker) {
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
  static getNodeLabel(node) {
  return node && node.getLocation().makeAriaLabel?
      node.getLocation().makeAriaLabel(): 'workspace';
}

  /**
 * Seeks the next inline input on node's AST parent after node itself.
 * @param {!Blockly.ASTNode} node the last sibiling searched
 * @return {Blockly.ASTNode} the first inline sibling after node, null if none.
 */
 static nextInlineInput(node) {
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
}

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
