# Power Apps Solution Quick Actions

Tampermonkey userscript for [make.powerapps.com](https://make.powerapps.com) that adds inline action
buttons to each row of the object grids inside a solution, so common per-row commands no longer require
opening the "More commands" (`...`) menu and its "Advanced" submenu.

Author: Giorgio Dalessandro, Food and Agriculture Organization of the United Nations (FAO).

## Installation

1. Install the [Tampermonkey](https://www.tampermonkey.net/) browser extension.
2. Open the Tampermonkey dashboard, create a new script and replace its content with
   `pp-solution-quick-actions.user.js`.
3. Save, then reload any open make.powerapps.com tab.

To update, replace the script content in Tampermonkey with the new file version and reload the page.

## Scope

The script is active only on:

```
https://make.powerapps.com/environments/{GUID}/solutions/{GUID}/...
```

i.e. on every page inside a solution (Overview, Objects, Cloud flows, Tables, ...), for any environment
and solution GUID. The solutions list itself is excluded.

make.powerapps.com is a single-page application, so the URL is checked at runtime on every page change
rather than through `@match` alone. On any other page the script removes its toolbars and its styles do
not apply. Environments whose id is not a plain GUID (e.g. `Default-{GUID}`) are not matched.

## Row buttons

| Button | Menu command | Location in the native menu | Availability |
| --- | --- | --- | --- |
| Deps | Show dependencies | Advanced | Always |
| Layers | See solution layers | Advanced | Always |
| Required | Add required objects | Advanced | Hidden when the row is managed (`Managed` = Yes) |
| Remove | Remove active customizations | Advanced | Disabled unless `Customized` = Yes |
| Turn off / Turn on | Turn off / Turn on | Top level | Label follows the `Status` column (On / Off); hidden otherwise, e.g. for non-flow objects |
| Runs | (link) | Not in the menu | Cloud flows only; opens the flow's "All runs" page in Power Automate |

In grids that lack the `Managed` or `Customized` column (e.g. Recent items on the Overview page), the
Required and Remove buttons stay available and the native menu decides whether the command is enabled.

Each button opens the row's native "More commands" menu, navigates to the item by its `data-test-key`
(opening plain submenus such as "Advanced" when needed) and clicks it. The menu is hidden while it is
driven programmatically. If the native item is disabled for that object, the button is greyed out with
a "not available for this object" tooltip and nothing is executed.

**Runs** does not use the menu: it navigates to
`https://make.powerautomate.com/environments/{environment}/solutions/{solution}/flows/{flowId}/runs`, taking the
environment and solution ids from the current URL and the flow id (`msdyn_workflowidunique`) from the grid row.
Ctrl/Cmd+click opens it in a new tab.

**Remove** and **Turn on / Turn off** change the environment: use them deliberately.

## Grid layout changes

Inside a solution the script also:

- hides the `Name`, `Owner`, `Last Modified` and `Managed` columns (the `Managed` value is still read
  for the Required rule);
- sets the `Display name` column width to 420px.

## Configuration

All settings are constants at the top of the script:

| Constant | Purpose |
| --- | --- |
| `ACTIONS` | Buttons, their menu `data-test-key`, label, tooltip and row-column rule (`enabledIfYes`, `hiddenIfYes`, `labelByColumn`) |
| `YES_TEXT` | Cell text treated as "Yes" (the UI language must be English) |
| `HIDDEN_COLUMNS` | Grid column keys to hide |
| `COLUMN_WIDTHS` | Fixed column widths in px |
| `TARGET_PATH` | URL path on which the script is active |
| `MENU_TIMEOUT_MS`, `SUBMENU_TIMEOUT_MS` | How long to wait for the menu and submenus to render |

Column keys are the `data-item-key` attributes of the grid header cells (e.g. `isManaged`,
`isCustomized`, `status`).

## Troubleshooting

Open the browser console and filter by `[ppqa]`:

- `[ppqa] Executed <key>`: the menu command was clicked.
- `[ppqa] Menu item not found: <key> available: [...]`: the command is not in the menu for that row;
  the list shows what was found, useful if Microsoft renames a `data-test-key`.
- `[ppqa] Menu did not open for <key>`: the "More commands" menu did not render in time; increase
  `MENU_TIMEOUT_MS`.

## Limitations

- Relies on the current Fluent UI DOM of make.powerapps.com (`data-test-key`, `data-automation-key`,
  `.ms-DetailsRow-fields`); a Microsoft UI update may require adjusting the selectors.
- The flow id for **Runs** is read from the grid row's React instance, since it is not exposed in the
  DOM; this requires the script to run in the page context (`@grant none`).
- Column rules compare English cell text (`Yes`, `On`, `Off`).

## License

Copyright (C) Food and Agriculture Organization of the United Nations (FAO).

Licensed under the GNU General Public License v3.0 or later; see [LICENSE](LICENSE). Redistributions,
modified or not, must keep the copyright and license notices and be released under the same license
with their source code.
