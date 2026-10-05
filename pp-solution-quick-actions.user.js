// ==UserScript==
// @name         Power Apps Solution Quick Actions
// @namespace    pp-tampermonkey
// @author       Giorgio Dalessandro
// @copyright    Food and Agriculture Organization of the United Nations (FAO)
// @license      GPL-3.0-or-later
// @version      1.8.1
// @description  Shows the per-row "More commands" menu items as inline buttons in the object grids of a solution.
// @match        https://make.powerapps.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // data-test-key values of the ContextualMenu items, in display order.
  // Row-column rules (column keys, compared against YES_TEXT):
  // enabledIfYes: the button is disabled unless the column shows YES_TEXT.
  // hiddenIfYes: the button is hidden when the column shows YES_TEXT.
  // visibleIfYes: the button is hidden unless the column shows YES_TEXT.
  // labelByColumn: the label follows the column value; hidden when the value has no label.
  // url: link button instead of a menu command; hidden when it returns null for the row.
  const ACTIONS = [
    {
      key: 'FlowRuns',
      label: 'Runs',
      title: 'Open all runs in Power Automate (new tab)',
      url: flowRunsUrl,
    },
    {
      key: 'RemoveActiveCustomizations',
      label: 'Remove',
      title: 'Remove active customizations',
      enabledIfYes: 'isCustomized',
      visibleIfYes: 'isManaged',
    },
    {
      key: 'ToggleFlow',
      label: 'Turn on/off',
      title: 'Turn the flow on or off',
      labelByColumn: { column: 'status', labels: { On: 'Turn off', Off: 'Turn on' } },
    },
    {
      key: 'AddRequiredComponents',
      label: 'Required',
      title: 'Add required objects',
      hiddenIfYes: 'isManaged',
    },
    { key: 'ShowDependencies', label: 'Deps', title: 'Show dependencies' },
    { key: 'SeeSolutionLayers', label: 'Layers', title: 'See solution layers' },

  ];
  const POWER_AUTOMATE_ORIGIN = 'https://make.powerautomate.com';
  const MODERN_FLOW_CATEGORY = 5;
  const YES_TEXT = 'Yes';
  // Column keys: data-item-key on header cells, data-automation-key on row cells.
  const HIDDEN_COLUMNS = ['uniqueName', 'owner', 'lastModificationDate', 'isManaged'];
  // Widths in px; applied to header and row cells alike so they stay aligned.
  const COLUMN_WIDTHS = { displayName: 420 };
  const MENU_TIMEOUT_MS = 2000;
  const SUBMENU_TIMEOUT_MS = 800;
  const TOOLBAR_CLASS = 'ppqa-toolbar';
  const BUSY_CLASS = 'ppqa-busy';
  const ACTIVE_CLASS = 'ppqa-active';
  // make.powerapps.com is a SPA: @match only fires on full loads, so the target page is checked at runtime.
  // Capture groups: environment id, solution id.
  const TARGET_PATH =
    /^\/environments\/([0-9a-f-]{36})\/solutions\/([0-9a-f-]{36})(\/|$)/i;

  const ROW_SELECTOR = '[role="row"]';
  const MENU_BUTTON_SELECTOR =
    '[data-automation-key="contextualMenu"] button[aria-haspopup="true"]';
  const ROW_FIELDS_SELECTOR = '.ms-DetailsRow-fields';
  const CALLOUT_SELECTOR = '.ms-ContextualMenu-Callout';

  const hiddenColumnsCss = HIDDEN_COLUMNS.map(
    (key) =>
      `html.${ACTIVE_CLASS} .ms-DetailsHeader-cell[data-item-key="${key}"], ` +
      `html.${ACTIVE_CLASS} .ms-DetailsHeader-cell[data-item-key="${key}"] + .ms-DetailsHeader-cellSizer, ` +
      `html.${ACTIVE_CLASS} [data-automation-key="${key}"] { display: none !important; }`
  ).join('\n');

  const columnWidthsCss = Object.entries(COLUMN_WIDTHS).map(
    ([key, width]) =>
      `html.${ACTIVE_CLASS} .ms-DetailsHeader-cell[data-item-key="${key}"], ` +
      `html.${ACTIVE_CLASS} [data-automation-key="${key}"] { width: ${width}px !important; }`
  ).join('\n');

  const style = document.createElement('style');
  style.textContent = `
    ${hiddenColumnsCss}
    ${columnWidthsCss}
    .${TOOLBAR_CLASS} { display: flex; align-items: center; gap: 4px; flex: 0 0 auto; padding: 0 8px; }
    .${TOOLBAR_CLASS} button {
      font: 600 11px/1 "Segoe UI", Arial, sans-serif;
      padding: 4px 6px; border: 1px solid #c8c6c4; border-radius: 2px;
      background: #fff; color: #323130; cursor: pointer;
    }
    .${TOOLBAR_CLASS} button:hover { background: #f3f2f1; border-color: #0078d4; }
    .${TOOLBAR_CLASS} button.ppqa-unavailable,
    .${TOOLBAR_CLASS} button[aria-disabled="true"] { opacity: .4; cursor: not-allowed; }
    .${TOOLBAR_CLASS} button[hidden] { display: none; }
    html.${BUSY_CLASS} ${CALLOUT_SELECTOR} { opacity: 0 !important; }
  `;
  document.head.appendChild(style);

  function waitFor(selector, timeoutMs) {
    return new Promise((resolve) => {
      const found = document.querySelector(selector);
      if (found) return resolve(found);
      const observer = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) {
          observer.disconnect();
          clearTimeout(timer);
          resolve(el);
        }
      });
      const timer = setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeoutMs);
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }

  // Fluent UI reacts to the full pointer sequence on some builds, so a bare element.click() is not enough.
  function simulateClick(el) {
    const init = { bubbles: true, cancelable: true, composed: true, view: window, button: 0 };
    el.dispatchEvent(new PointerEvent('pointerdown', init));
    el.dispatchEvent(new MouseEvent('mousedown', init));
    el.dispatchEvent(new PointerEvent('pointerup', init));
    el.dispatchEvent(new MouseEvent('mouseup', init));
    el.dispatchEvent(new MouseEvent('click', init));
  }

  function closeMenu(menuButton) {
    if (menuButton.getAttribute('aria-expanded') === 'true') simulateClick(menuButton);
  }

  const MENU_ITEM_SELECTOR = `${CALLOUT_SELECTOR} [role="menuitem"]`;

  function findItem(key) {
    return document.querySelector(`${CALLOUT_SELECTOR} [data-test-key="${key}"]`);
  }

  function describeVisibleItems() {
    return [...document.querySelectorAll(MENU_ITEM_SELECTOR)].map(
      (el) => `${el.getAttribute('data-test-key') || '?'} "${el.textContent.trim()}"`
    );
  }

  // Split items (e.g. "Edit", "Details") also report aria-haspopup, but clicking them runs their
  // primary command (navigation), so only plain, enabled submenu buttons are safe to open.
  function isSubmenuTrigger(el) {
    return (
      el.tagName === 'BUTTON' &&
      el.getAttribute('aria-haspopup') === 'true' &&
      el.getAttribute('aria-disabled') !== 'true'
    );
  }

  // Some commands live in a submenu (e.g. "Advanced"), whose items only exist once it is opened.
  async function findItemInSubmenus(key) {
    const opened = new Set();
    for (; ;) {
      const trigger = [...document.querySelectorAll(MENU_ITEM_SELECTOR)].find(
        (el) => isSubmenuTrigger(el) && !opened.has(el)
      );
      if (!trigger) return null;
      opened.add(trigger);
      simulateClick(trigger);
      const item = await waitFor(
        `${CALLOUT_SELECTOR} [data-test-key="${key}"]`,
        SUBMENU_TIMEOUT_MS
      );
      if (item) return item;
    }
  }

  async function runAction(row, action, sourceButton) {
    const menuButton = row.querySelector(MENU_BUTTON_SELECTOR);
    if (!menuButton) {
      console.warn('[ppqa] Menu button not found in row', row);
      return;
    }

    // Hide the callout while it is driven programmatically to avoid a visible flicker.
    document.documentElement.classList.add(BUSY_CLASS);
    try {
      closeMenu(menuButton);
      simulateClick(menuButton);
      if (!(await waitFor(MENU_ITEM_SELECTOR, MENU_TIMEOUT_MS))) {
        console.warn('[ppqa] Menu did not open for', action.key);
        return;
      }
      const item = findItem(action.key) || (await findItemInSubmenus(action.key));
      if (!item) {
        console.warn('[ppqa] Menu item not found:', action.key, 'available:', describeVisibleItems());
        closeMenu(menuButton);
        return;
      }
      if (item.getAttribute('aria-disabled') === 'true') {
        sourceButton.classList.add('ppqa-unavailable');
        sourceButton.title = `${action.title} (not available for this object)`;
        closeMenu(menuButton);
        return;
      }
      simulateClick(item);
      console.info('[ppqa] Executed', action.key);
    } catch (error) {
      console.error('[ppqa] Action failed:', action.key, error);
    } finally {
      document.documentElement.classList.remove(BUSY_CLASS);
    }
  }

  function buildToolbar(row) {
    const toolbar = document.createElement('div');
    toolbar.className = TOOLBAR_CLASS;
    toolbar.setAttribute('data-selection-disabled', 'true');
    for (const action of ACTIONS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = action.label;
      button.title = action.title;
      button.dataset.ppqaKey = action.key;
      // Keep the row's FocusZone/SelectionZone from handling presses on the toolbar.
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
        button.addEventListener(type, (event) => event.stopPropagation());
      }
      button.addEventListener('click', (event) => {
        // Prevent the DetailsList from treating the click as row selection/navigation.
        event.preventDefault();
        event.stopPropagation();
        if (action.url) {
          openInNewTab(action.url(row));
          return;
        }
        if (
          button.classList.contains('ppqa-unavailable') ||
          button.getAttribute('aria-disabled') === 'true'
        ) {
          return;
        }
        runAction(row, action, button);
      });
      toolbar.appendChild(button);
    }
    return toolbar;
  }

  // The grid exposes no ids in the DOM, so the row item is read from the React instance of the row.
  function getRowItem(row) {
    const key = Object.keys(row).find(
      (k) => k.startsWith('__reactInternalInstance$') || k.startsWith('__reactFiber$')
    );
    for (let fiber = key && row[key]; fiber; fiber = fiber.return) {
      const item = fiber.memoizedProps && fiber.memoizedProps.item;
      if (item) return item;
    }
    return null;
  }

  function flowRunsUrl(row) {
    const match = TARGET_PATH.exec(location.pathname);
    const component = getRowItem(row)?.component;
    if (!match || component?.msdyn_workflowcategory !== MODERN_FLOW_CATEGORY) return null;
    const flowId = component.msdyn_workflowidunique;
    if (!flowId) return null;
    const [, environmentId, solutionId] = match;
    return `${POWER_AUTOMATE_ORIGIN}/environments/${environmentId}/solutions/${solutionId}/flows/${flowId}/runs`;
  }

  function openInNewTab(url) {
    if (!url) {
      console.warn('[ppqa] No URL for this row');
      return;
    }
    window.open(url, '_blank', 'noopener');
  }

  // Returns null when the grid has no such column (e.g. Recent items), so no rule is applied there.
  function columnIsYes(row, columnKey) {
    const cell = row.querySelector(`[data-automation-key="${columnKey}"]`);
    return cell ? cell.textContent.trim() === YES_TEXT : null;
  }

  function applyColumnLabel(row, button, { column, labels }) {
    const cell = row.querySelector(`[data-automation-key="${column}"]`);
    const label = cell ? labels[cell.textContent.trim()] : undefined;
    button.hidden = !label;
    // Writing the same text would still mutate the DOM and re-trigger the observer in a loop.
    if (label && button.textContent !== label) {
      button.textContent = label;
      button.title = label;
    }
  }

  // Re-evaluated on every pass because virtualized rows are reused for other items.
  function updateToolbarState(row, toolbar) {
    for (const action of ACTIONS) {
      const button = toolbar.querySelector(`[data-ppqa-key="${action.key}"]`);
      if (action.hiddenIfYes) {
        button.hidden = columnIsYes(row, action.hiddenIfYes) === true;
      }
      if (action.visibleIfYes) {
        button.hidden = columnIsYes(row, action.visibleIfYes) === false;
      }
      if (action.url) button.hidden = !action.url(row);
      if (action.labelByColumn) applyColumnLabel(row, button, action.labelByColumn);
      if (action.enabledIfYes) {
        const allowed = columnIsYes(row, action.enabledIfYes) !== false;
        button.setAttribute('aria-disabled', String(!allowed));
        if (!button.classList.contains('ppqa-unavailable')) {
          button.title = allowed ? action.title : `${action.title} (not available for this object)`;
        }
      }
    }
  }

  function decorateRows() {
    for (const row of document.querySelectorAll(ROW_SELECTOR)) {
      if (!row.querySelector(MENU_BUTTON_SELECTOR)) continue;
      const fields = row.querySelector(ROW_FIELDS_SELECTOR);
      if (!fields) continue;
      let toolbar = fields.querySelector(`.${TOOLBAR_CLASS}`);
      if (!toolbar) {
        toolbar = buildToolbar(row);
        fields.appendChild(toolbar);
      }
      updateToolbarState(row, toolbar);
    }
  }

  // Toolbars left over from the target page are removed in case the grid survives the navigation.
  function refresh() {
    const active = TARGET_PATH.test(location.pathname);
    document.documentElement.classList.toggle(ACTIVE_CLASS, active);
    if (active) {
      decorateRows();
    } else {
      for (const toolbar of document.querySelectorAll(`.${TOOLBAR_CLASS}`)) toolbar.remove();
    }
  }

  // The grid is React-rendered and virtualized, so rows are re-created on scroll, filter and navigation.
  let scheduled = false;
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      refresh();
    });
  }).observe(document.body, { childList: true, subtree: true, characterData: true });

  refresh();
})();
