/* ============================================================
   run-ae.jsx — entry point for aerender.

   aerender can only load a project, not a loose .jsx, so this is a
   one-line project that imports the real builder and runs it. Keeping
   the puppet code in puppetify.jsx means it stays readable and can be
   re-run from the AE UI (File ▸ Scripts ▸ Run Script File) while
   iterating on the curves, which is where this kind of work actually
   gets tuned.

   Usage:
     aerender.exe -project tools/ae/run-ae.aep -r rem-puppet
   or from a shell:
     AfterFX.com -r rem-puppet
   ============================================================ */

(function () {
  var here = new File($.fileName).parent;
  var builder = new File(here.fsName + '/puppetify.jsx');
  if (!builder.exists) { alert('puppetify.jsx missing next to this file'); return; }
  $.evalFile(builder);
})();