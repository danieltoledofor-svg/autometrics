const fs = require('fs');

let content = fs.readFileSync('app/integration/page.tsx', 'utf8');

// 1. Find the logs tab block
const logsStart = content.indexOf('{/* ── ABA: LOGS ─────────────────────── */}');
const vturbStart = content.indexOf('{/* ── ABA 4: VTURB ─────────────────────────────────────── */}');

let beforeLogs = content.substring(0, logsStart);
let logsBlock = content.substring(logsStart, vturbStart);
let afterVturb = content.substring(vturbStart);

// We know `logsBlock` contains the floating "2. Rastreio de Checkout" block
// because it starts at line 931, between logs (928) and vturb (997).
// The floating block starts with: `<div className={\`p-4 rounded-xl border \${isDark ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-200 shadow-sm'}\`}>`
// and ends with `)}` at line 995.

const floatingBlockStart = logsBlock.indexOf('<div className={`p-4 rounded-xl border ${isDark ? \'bg-slate-900 border-slate-700\' : \'bg-white border-slate-200 shadow-sm\'}`}>');

let actualLogsBlock = logsBlock.substring(0, floatingBlockStart).trim();
let floatingBlock = logsBlock.substring(floatingBlockStart).trim();

// Remove the dangling `)}` from the end of floatingBlock
if (floatingBlock.endsWith(')}')) {
    floatingBlock = floatingBlock.substring(0, floatingBlock.length - 2).trim();
}

// Now we have the detailed "2. Rastreio de Checkout" block in `floatingBlock`.
// We need to inject `floatingBlock` inside the `pixel` tab!
// The `pixel` tab is in `beforeLogs`.
// Let's find where the `pixel` tab closes. 
// It ends with:
//               </div>
//             </div>
//           </div>
//         )}
// Let's find the simple "2. Pixel de Checkout" block in `beforeLogs` and replace it with `floatingBlock`.

const simpleCheckoutStart = beforeLogs.indexOf('<div>\n                <div className="flex items-center justify-between mb-2">\n                  <p className={`text-xs font-bold uppercase ${textMuted}`}>2. Pixel de Checkout — colar na Plataforma de Pagamento</p>');

if (simpleCheckoutStart !== -1) {
    // Cut out the simple checkout block
    let pixelTabBeforeSimple = beforeLogs.substring(0, simpleCheckoutStart);
    // Find the end of the pixel tab:
    // It closes with `</div>\n            </div>\n          </div>\n        )}`
    // Let's just find the `)}` that closes the pixel tab.
    const pixelTabEnd = beforeLogs.lastIndexOf(')}');
    
    // Construct the new beforeLogs
    beforeLogs = pixelTabBeforeSimple + floatingBlock + '\n            </div>\n          </div>\n        )}\n\n        ';
}

// Reconstruct the file
let newContent = beforeLogs + actualLogsBlock + '\n\n        ' + afterVturb;

fs.writeFileSync('app/integration/page.tsx', newContent);
console.log("Fixed page.tsx structure");

