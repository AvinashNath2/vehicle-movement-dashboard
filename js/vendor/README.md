# Vendored libraries

These files are bundled in the repo (instead of loaded from a CDN) so the
dashboard keeps working on restricted/offline office networks.

| File | Library | Version | License |
|---|---|---|---|
| `xlsx.full.min.js` | [SheetJS / xlsx](https://sheetjs.com/) | 0.18.5 | Apache-2.0 |
| `jspdf.umd.min.js` | [jsPDF](https://github.com/parallax/jsPDF) | 2.5.1 | MIT |
| `jspdf.plugin.autotable.min.js` | [jspdf-autotable](https://github.com/simonbengtsson/jsPDF-AutoTable) | 3.8.2 | MIT |

To upgrade, download the matching build from the project's npm package /
release and replace the file with the same name — no other code changes
are required as long as the global names (`XLSX`, `window.jspdf.jsPDF`,
`doc.autoTable`) stay the same.
