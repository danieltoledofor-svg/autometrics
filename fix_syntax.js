const fs = require('fs');
let content = fs.readFileSync('app/integration/page.tsx', 'utf8');

// Fix floating "2. Rastreio de Checkout" section by removing the duplicate simplified one
// and wrapping everything correctly.

// Let's just fix the `</script>` template literal issues first.
content = content.replace(/<\/script>`}/g, "</` + `script>`}");

// Also fix the copyPostback strings that have </\script> or similar.
content = content.replace(/<\/[\\s]*script>/g, "<" + "/script>");

// Now let's fix the structural issue: 
// The "Logs" tab is rendered, and then the OLD "Rastreio de Checkout" is rendered outside any conditional.
// We need to move the OLD "Rastreio de Checkout" BACK into the "pixel" tab.
// Currently the "pixel" tab ends at line 868. The "Logs" tab ends at line 928.
// We will simply extract the "Logs" tab, and put it AFTER the OLD "Rastreio de Checkout".

fs.writeFileSync('app/integration/page.tsx', content);
