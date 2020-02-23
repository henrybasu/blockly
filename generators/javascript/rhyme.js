'use strict';

goog.provide('Blockly.JavaScript.rhyme');

goog.require('Blockly.JavaScript');

Blockly.JavaScript['rhyme_little_lamb'] = function(block) {
	return block.getFieldValue('TEXT');
}

Blockly.JavaScript['rhyme_mary_had_a'] = function(block) {
	return block.getFieldValue('TEXT');
}

Blockly.JavaScript['rhyme_whose_fleece'] = function(block) {
	return block.getFieldValue('TEXT');
}

Blockly.JavaScript['rhyme_say'] = function(block) {
	var lineToSay = Blockly.JavaScript.statementToCode(block, 'TEXT');
	var utter = new SpeechSynthesisUtterance();
	utter.text = lineToSay;
	window.speechSynthesis.speak(utter);
}