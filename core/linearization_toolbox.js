/**
 * @fileoverview The class for generating accessible linearization
 * of the toolbox and flyout
 */

goog.provide('Blockly.LinearizationToolbox');

goog.require('Blockly.Toolbox');
goog.require('Blockly.Xml');
goog.require('Blockly.VariableMap');
goog.require('Blockly.Events');

Blockly.LinearizationToolbox = function(workspace) {
  /** @const {!Blockly.workspace} */
  this.workspace = workspace;

  /**
   * Amount of x-distance to shift when adding blocks
   * @type {number}
   */
   this.dx = 0;
  /**
   * Amount of y-distance to shift when adding blocks
   * @type {number}
   */
   this.dy = 0;
  /**
   * Highest amount of dx necessary to shift when adding blocks
   * @type {number}
   */
   this.maxdx = 0;

  this.injectAccessibleToolbox('blocklyDiv');
  document.getElementsByClassName('injectionDiv')[0].style = "float:left; width:70%;";
}

/**
 * Adjusts global offset to add to blocks when blocks are added or removed
 *
 */
Blockly.LinearizationToolbox.Prototype.onBlockAddOrRemove = function(event) {
  var block = this.workspace.getBlockById(event.blockID);

  // check if block exists to avoid error
  // TODO: clean up redundancy, also fix this: the reduction of dy when blocks are deleted doesn't work 
  if (block) {
    var w = block.getHeightWidth().width;
    var h = block.getHeightWidth().height;

    if (event.type === "create") {
      if (w >= maxdx) {
        maxdx = w;
      }
      if (dy >= 500) {
        dy = 0;
        dx += maxdx;
      } else {
        dy += h + 10;
      }
    }
  
    if (event.type === "delete") {
      dy -= (h + 10);
    }
  }

  if (event.type === "delete") {
    this.updateFlyout();
  }

  if (event.type === "change") {
    if (event.element === 'field' && event.name === 'NAME') {
      this.updateFlyout();
    }
  }
}

// container: the container blockly is in
// TODO: split into 2 methods, one to inject html 
// // and one to populate category menu
Blockly.LinearizationToolbox.Prototype.injectAccessibleToolbox = function(container) {
  container = document.getElementById('blocklyDiv');
  // overarching container for the flyout + toolbox assembly
  var subContainer = document.createElement('div');
  subContainer.setAttribute('id', 'addBlocks');
  // rests to the right of the workspace
  var testNode = document.createElement('p');
    subContainer.appendChild(testNode);

  // container with actual blocks
  var flyoutContainer = document.createElement('div');
  flyoutContainer.setAttribute('id', 'flyoutContainer');
  var blockList = document.createElement('ul');
  flyoutContainer.appendChild(blockList);
  // container with categories/controls
  var navContainer = document.createElement('div');
  navContainer.setAttribute('id', 'navBar');
  
  this.appendChildren(subContainer, [flyoutContainer, navContainer]);

  var buttonList = document.createElement('ul');
  navContainer.appendChild(buttonList);

  this.workspace.getToolbox().tree_.getChildren()
    .filter(child => !(child instanceof Blockly.Toolbox.TreeSeparator))
    .map((child) => {
      var buttonSpan = document.createElement('span');
      buttonSpan.setAttribute('role', 'button'); // for accessibility
      var button = document.createElement('li');
      button.setAttribute('class', 'categoryButton');
      buttonSpan.innerText = child.getElement().innerText;

      button.addEventListener('click', () => {populateFlyout(child)});
      button.appendChild(buttonSpan);
      buttonList.appendChild(button);
    }
  )
  subContainer.appendChild(navContainer);
  container.appendChild(subContainer);
}

// takes in a node from category tree and populates flyout with that category's blocks
Blockly.LinearizationToolbox.Prototype.populateFlyout = function(treeNode) {
  console.log('clicked!');
  var blockList = undefined;
  // for variables and functions
  if (typeof treeNode.blocks === 'string') {
    // getting the function which gets the proper blocks for 'custom' category
    var fn = this.workspace.getToolboxCategoryCallback(treeNode.blocks);
    blockList = fn(this.workspace); // getting the blocks for the category
  } else {
    var blockList = [...treeNode.blocks];
  }

  var flyout = document.getElementById('flyoutContainer');
  flyout.setAttribute('curSelected', treeNode.styleName);
  var blockListElem = flyout.firstChild;  
  blockListElem.setAttribute('id', 'blockList');
  blockListElem.innerHTML = '';

  // TODO: update call function block names when you change name on workspace
  // to do this, try linking the call function blocks in flyout to their def functino blocks in workspace
  // then, listen for change events and go thru all of them?
  blockList.filter((item) => item.tagName.toUpperCase() === 'BLOCK')
    .map((block) => {
      var blockElem = document.createElement('li');
      blockElem.setAttribute('class', 'blockItem');
      var blockButton = document.createElement('span');   
      blockButton.setAttribute('role', 'button');
      /** block type as label vs. aria label (kinda bad sometimes) as label **/
      // blockButton.textContent = block.getAttribute('type');
      var labelAndDescrip = this.getLabelAndDescription(block);
      blockButton.textContent = labelAndDescrip[0];
      blockButton.setAttribute('aria-label', labelAndDescrip[0]);
      blockButton.setAttribute('aria-description', 'test description');
  
      blockElem.appendChild(blockButton);
      blockElem.addEventListener('click', e => addBlockToWorkspace(block));
      blockListElem.appendChild(blockElem); 
    }
  )
  flyout.appendChild(blockListElem)
}

// block DOM object as input
Blockly.LinearizationToolbox.Prototype.getLabelAndDescription = function(blockDOM) {
  Blockly.Events.disable();
  var tempBlock = Blockly.Xml.domToBlock(blockDOM, this.workspace);
  tempBlock.render();
  var ariaLabel = tempBlock.makeAriaLabel();
  var ariaDescription = tempBlock.svgPath_.tooltip;
  var varList = tempBlock.getVarModels(); //TODO: sometime this is undefined? for (call do_something w/ return) blocks

  // TODO: document.defaultView is incompatible with Microsoft browsers before IE9
  // TODO: still get variable menu disappearing issue
  // ---> check that variable uses are only on tempBlock
  if (varList) {
    varList.filter(variable => Blockly.VariableMap.prototype
      .getVariableUsesById.call(document.defaultView, variable.getId()).length === 1)
      .forEach(item => {this.workspace.getVariableMap().deleteVariable(item)});
  }
  tempBlock.dispose();
  Blockly.Events.enable();
  return [ariaLabel, ariaDescription];
}

Blockly.LinearizationToolbox.Prototype.domToBlockData = function(elem) {
  Blockly.Events.disable();  
  try {
    var block = this.workspace.newBlock(elem.getAttribute('type'));
  } catch {
    console.log('catch2', elem);
  }
  Blockly.Events.enable();
  return block;
}

var dx = 0;
var maxdx = 0;
var dy = 0;

// block DOM object as input
Blockly.LinearizationToolbox.Prototype.addBlockToWorkspace = function (blockDOM) {
  // var block = workspace.newBlock(blockType)
  var block = Blockly.Xml.domToBlock(blockDOM, this.workspace);
  block.moveBy(dx, dy);
  block.initSvg();
  this.workspace.render();
  if (block.getHeightWidth().width >= maxdx) {
    maxdx = block.getHeightWidth().width;
  }
  if (dy >= 500) {
    dy = 0;
    dx += maxdx;
  } else {
    dy += (block.getHeightWidth().height + 10);
  }
  updateFlyout();
}

Blockly.LinearizationToolbox.Prototype.updateFlyout = function() {
  var curCategory = this.workspace.getToolbox().tree_.getChildren()
    .filter(child => child.styleName === flyoutContainer.getAttribute('curSelected'))[0];
  this.populateFlyout(curCategory);
}

Blockly.LinearizationToolbox.Prototype.appendChildren = function(element, children) {
  for (var child of children) {
    element.appendChild(child);
  }
}