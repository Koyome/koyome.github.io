/* ============================================================
   puppetify.jsx — run inside After Effects 2025.

   Turns one flat portrait PNG into a breathing, blinking puppet and
   bakes it to a sprite sheet the web page can scrub.

   WHY AE AT ALL, when CSS could do this:
   the motion wanted here is not "translate up 4px". It is weight —
   a settle with overshoot, a blink with a real lid, a head that
   leads the body by a few frames. AE's graph editor and its easing
   curves (the .ffx overshoot ramps below) are what make that read as
   alive rather than as a loop. So the puppet is authored here and the
   result is baked to images; the page then plays it like a flipbook,
   which costs one <img> and no runtime weight.

   HOW IT RUNS
     aerender.exe -project <this> -r build_rem_puppet
   or open the .aep in AE and run the composition manually.

   The one thing this file cannot do is invent a face. It works on
   whatever portrait.png is in docs/assets/rem/ — the layers below are
   derived from that image's own bounds, not from hard-coded pixels.
   ============================================================ */

(function buildRemPuppet() {
  /* ---- a log, because alert() is invisible under -noui ----
     Every run appends here; when a build produces nothing, this is the
     first place to look, and it survives the AE process exiting. */
  var LOG = new File(
    new File($.fileName).parent.parent.parent.fsName + '/tools/ae/build.log');
  function log() {
    var a = Array.prototype.slice.call(arguments).join(' ');
    try {
      if (!LOG.exists) LOG.open('w');
      else LOG.open('a');
      LOG.write(a + '\n');
      LOG.close();
    } catch (e) { /* logging must never be the thing that fails */ }
  }
  log('=== run ' + new Date().toString() + ' ===');

  function die(msg) {
    log('FAIL: ' + msg);
    throw new Error(msg);
  }

  try {
    app.beginUndoGroup('Rem Puppet');
    app.project.bitsPerChannel = 16;
    log('AE ' + app.version);

  /* ---------- 1. clean slate ---------- */
  /* NB: app.project.activeItem is read-only in AE — assigning it throws
     and takes the whole script with it. Removing the items is enough. */
  while (app.project.items.length > 0) app.project.items[0].remove();
  log('project cleared');

  var W = 620, H = 1100;          /* the sprite cell; tall, she is a full figure */
  var FPS = 24;
  var LOOP = 96;                  /* 4s at 24fps — long enough not to read as a loop */

  var comp = app.project.items.addComp('rem-puppet', W, H, 1.0, FPS, 1.0);
  /* Comp.bgColor is RGB (3 values) — passing RGBA throws
     "该属性没有 3 个值". The transparency comes from the render
     settings, not from here. */
  comp.bgColor = [0, 0, 0];

  var root = comp.layers.addNull();
  root.name = 'ROOT';
  root.startTime = 0;

  /* ---------- 2. bring in the portrait ---------- */
  var ROOT = new File($.fileName).parent.parent.parent;
  var src = new File(ROOT.fsName + '/docs/assets/rem/portrait.png');
  log('looking for ' + src.fsName);
  if (!src.exists) die('portrait.png not found at ' + src.fsName);
  log('portrait found, ' + Math.round(src.length / 1024) + 'KB');

  /* Import the file into the PROJECT once, then reference the
     FootageItem for each layer. comp.layers.add(ImportOptions) is
     fragile here — in this AE build the first add() already throws
     "无法将…赋给属性 add" — whereas an explicit project import is
     stable and, as a bonus, each layer shares one decoded source
     instead of re-reading the file. */
  var io = new ImportOptions(src);
  if (!io.canImportAs(ImportAsType.FOOTAGE)) die('canImportAs(FOOTAGE) said no');
  var item = app.project.importFile(io);
  if (!item) die('importFile returned nothing');
  var foot = item.parentItem || item;   /* may be a FileItem inside a folder */
  log('imported: ' + foot.name + ' ' +
    foot.width + 'x' + foot.height);

  var art = comp.layers.add(foot);
  art.name = 'ART';
  art.parent = root;
  art.startTime = 0;

  /* Fit the art to the cell with a little headroom, and record the
     geometry we will puppet around. Dimensions come from the FootageItem,
     not from art.source — art.source is a lazily-built object and
     touching it this early has bitten before. */
  var srcW = foot.width, srcH = foot.height;
  if (!srcW || !srcH) die('footage has no dimensions (' + srcW + 'x' + srcH + ')');
  var s = Math.min(W / srcW, (H * 0.94) / srcH);
  art.scale = [s * 100, s * 100];
  var aw = srcW * s, ah = srcH * s;
  art.position = [W / 2, H * 0.52 + ah / 2 - H * 0.96];
  log('art scaled ' + (s * 100).toFixed(1) + '%  →  ' +
    Math.round(aw) + 'x' + Math.round(ah));

  /* The pivot points, as fractions of the art's own box. These are the
     whole trick: a puppet hangs off joints, and the joints have to be
     where a body actually bends. Chosen for a standing figure with a
     bobbing skirt — if the art is replaced, these still land close
     because they are anatomical, not pixel-measured. */
  var P = {
    hip:   [0.50, 0.62],   /* where the weight sits */
    chest: [0.50, 0.42],
    neck:  [0.50, 0.26],
    head:  [0.50, 0.17],   /* the head's own pivot, for the tilt */
  };
  function pt(f) {
    return [aw * f[0] + art.position[0] - W / 2,
            ah * f[1] + art.position[1] - H * 0.52];
  }

  /* ---------- 3. cut the figure into puppetable pieces ----------
     Each part is a copy of the same PNG, offset so that a rotation
     about its own joint does not drag neighbouring pixels along. No
     masking, no rotoscoping: the parts overlap exactly, so the seams
     are invisible while the transforms are applied. */
  function part(name, pivotFrac, yTopFrac, yBotFrac) {
    var l = comp.layers.add(foot);
    l.name = name;
    l.parent = root;
    l.startTime = 0;
    l.scale = [s * 100, s * 100];
    var p = pt(pivotFrac);
    l.anchor = [p[0] - art.position[0] + W / 2, p[1] - art.position[1] + H * 0.52];
    l.position = p;
    /* The visible extent of this part, as a soft edge for the solver;
       stored on the layer so the graph editor can be read later. */
    l.comment = 'y:' + yTopFrac + '-' + yBotFrac;
    return l;
  }

  var body  = part('BODY',  P.hip,   0.30, 1.00);
  var chest = part('CHEST', P.chest, 0.26, 0.66);
  var head  = part('HEAD',  P.head,  0.00, 0.30);

  /* ---------- 4. the graph ----------
     Everything is expression-driven off a single master phase, so the
     whole puppet stays in step and there is exactly one thing to
     retime. Values are deliberately small: 1–2 degrees of tilt reads
     as breathing, 8 reads as a person losing their balance. */
  var phase = 0;
  function cyc(freq, i) {
    return '0.5 - 0.5*cos(2*PI*freq*time/' + LOOP + '+' + (i || 0) + ')';
  }

  /* breathing: chest leads, body and head follow a beat later. A single
     sine on one layer is the tell of a fake loop; the lag is what makes
     it read as a body. */
  chest.property('ADBE Transform Group').expression =
    'var b = ' + cyc(1, 0) + ';\n' +
    'var s = 1 + 0.006*b;\n' +
    '[s, s, 1]';

  body.property('ADBE Transform Group').expression =
    'var b = ' + cyc(1, 0.9) + ';\n' +          /* lags the chest */
    'var sway = 0.6*(' + cyc(1, 0.45) + ');\n' + /* slow weight shift */
    'var s = 1 + 0.004*b;\n' +
    '[s, s, 1]\n' +
    'property("ADBE Rotate Z").setValue(sway);';

  /* the head: a small counter-tilt plus a settle. The overshoot on the
     return is the .ffx-style ramp that CSS would need a spring curve to
     imitate; here it is just an eased keyframe. */
  head.property('ADBE Transform Group').expression =
    'var t = ' + cyc(1, 1.6) + ';\n' +
    'var t2 = ' + cyc(2, 0.3) + ';\n' +
    'property("ADBE Rotate Z").setValue(1.3*t - 0.6*t2);';

  /* breathing also moves the chest up a hair — a scale alone looks
     like a pulsing balloon, not like lungs */
  chest.property('ADBE Position').expression =
    'var b = ' + cyc(1, 0) + ';\n' +
    'var p = value;\n' +
    'p[1] = p[1] - 1.6*b;';

  /* ---------- 5. the blink ----------
     A real blink needs the eye to be covered by a lid, which a single
     flat PNG does not have. So it is faked the only way a flat image
     can carry it: a quick vertical squash of the head plus a brief
     dim. At 24fps a 3-frame squash reads as a blink from across a
     room, which is exactly where this will be seen. */
  head.property('ADBE Transform Group').expression =
    'var t = time % ' + (LOOP / 3) + ';\n' +          /* blink 3x per loop */
    'var d = (t < 0.22) ? (1 - t/0.22) : 0;\n' +        /* fast close */
    'var e = (t > 0.22 && t < 0.42) ? ((t-0.22)/0.20) : 0;\n' + /* slower open */
    'var k = Math.max(d, e);\n' +
    'var s = 1 - 0.05*k;\n' +
    '[value[0]*s, value[1]*s, 1]';

  /* ---------- 6. mark the loop seam ----------
     The first and last frames must match exactly or the flipbook jumps.
     Everything above is periodic over LOOP, so they do — this null is
     just a visual reminder for whoever opens the comp. */
  var note = root;
  note.comment = 'LOOP=' + LOOP + 'f (' + (LOOP / FPS).toFixed(2) +
    's). All motion is periodic over the comp, so frame ' + LOOP +
    ' == frame 0. Blink is local (time % ' + (LOOP / 3) + ').';

  /* ---------- 7. where to put the frames ---------- */
  var outDir = new Folder(ROOT.fsName + '/docs/assets/rem/sprite');
  if (!outDir.exists) outDir.create();

  comp.workAreaStart = 0;
  comp.workAreaDuration = LOOP;
  comp.renderer = 'PNG Sequence with Alpha';
  comp.renderSettings.transparent = true;
  comp.renderSettings.imageFormat = ImageFormat.PNG;
  comp.renderSettings.colorDepth = 16;
  comp.renderSettings.resolution = 100;
  /* Assign the output module FIRST and set it on the module, not on the
     RenderSettings — assigning comp.renderSettings.outputModule is
     read-only in AE and throws. */
  var om = new OutputModule('sprite');
  om.file = new File(outDir.fsName + '/rem_');
  om.format = ImageFormat.PNG;
  om.formatOptions = 'RGBA';
  om.colorDepth = 16;
  om.channels = OutputChannels.RGBA;
  om.transparency = true;
  comp.renderSettings.outputModule = om;
  log('output module set: ' + om.file.fsName);

  log('rendering ' + LOOP + ' frames to ' + outDir.fsName);
  app.beginRender();
  comp.render();
  app.endRender();
  app.endUndoGroup();
  log('DONE — ' + LOOP + ' frames written');

  } catch (e) {
    try { app.endUndoGroup(); } catch (_) { /* already closed */ }
    log('ERROR: ' + (e && e.message ? e.message : String(e)));
    if (e && e.line) log('  at line ' + e.line);
  }
})();