/* min2 — is a MULTI-LINE script the problem?
   _min.jsx ran on one line and worked; this is the same work spread
   over several lines with a helper function, to find out whether AE
   is choking on newlines or on something else. */
(function () {
  var LOG = new File(new File($.fileName).parent.fsName + '/_min2.txt');
  function L(s) {
    try {
      if (!LOG.exists) LOG.open('w'); else LOG.open('a');
      LOG.write(s + '\n');
      LOG.close();
    } catch (e) { }
  }
  L('start');
  L('version=' + app.version);
  L('items=' + app.project.items.length);
  L('end');
})();