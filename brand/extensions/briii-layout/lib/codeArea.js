// Hides the code area when the last file closes. Extensions can't read whether the area is
// visible and VS Code only offers a toggle, so this tracks it: the area is surely visible while
// files are open (VS Code shows it again by itself when a file opens), unless it was hidden by
// hand with Briii's Ctrl+Alt+W. At startup with no files the restored state is unknown, so
// nothing happens until a file has been open.
'use strict';

class CodeArea {
	/**
	 * @param {number} tabs open editor tabs at startup
	 * @param {boolean} [startHidden] the area is known to start hidden (files open, none visible)
	 */
	constructor(tabs, startHidden = false) {
		this.tabs = tabs;
		this.known = tabs > 0;
		this.hidden = startHidden;
	}

	/** @returns {'toggle' | null} 'toggle' when the area should be hidden now */
	tabsChanged(tabs, enabled) {
		const prev = this.tabs;
		this.tabs = tabs;
		if (tabs > 0) {
			this.known = true;
			this.hidden = false;
			return null;
		}
		if (prev > 0 && this.known && !this.hidden && enabled) {
			this.hidden = true;
			return 'toggle';
		}
		return null;
	}

	/** Ctrl+Alt+W: always toggles, and keeps track of the result. */
	toggle() {
		this.hidden = !this.hidden;
		this.known = true;
		return 'toggle';
	}
}

module.exports = { CodeArea };
