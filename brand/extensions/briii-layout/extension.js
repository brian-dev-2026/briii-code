// Briii Layout: open and close Claude's panel from visible buttons, and hide the empty code area.
'use strict';

const vscode = require('vscode');
const { CodeArea } = require('./lib/codeArea');

const openTabs = () => vscode.window.tabGroups.all.reduce((n, g) => n + g.tabs.length, 0);

function activate(context) {
	const closeClaude = () => vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
	const tabs = openTabs();
	// Files open but no text editor visible: the area was hidden by hand in the last session.
	const area = new CodeArea(tabs, tabs > 0 && vscode.window.visibleTextEditors.length === 0 &&
		vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputText);
	const enabled = () => vscode.workspace.getConfiguration('briii.layout').get('hideEmptyCodeArea', true);
	const toggleArea = () => vscode.commands.executeCommand('workbench.action.toggleEditorVisibility');

	context.subscriptions.push(
		vscode.commands.registerCommand('briii.claude.close', closeClaude),
		vscode.commands.registerCommand('briii.claude.hide', closeClaude),
		vscode.commands.registerCommand('briii.layout.toggleCodeArea', () => area.toggle() && toggleArea()),
		vscode.window.tabGroups.onDidChangeTabs(() => {
			if (area.tabsChanged(openTabs(), enabled())) {
				toggleArea();
			}
		}),
	);
}

function deactivate() {}

module.exports = { activate, deactivate };
