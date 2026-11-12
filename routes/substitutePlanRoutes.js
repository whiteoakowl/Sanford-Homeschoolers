// Substitute plan pages for one class - shared by Co-op Teacher Portal
// (routes/teacher-portal.js, the teacher's own classes) and Co-op Admin
// (routes/admin-class-schedule.js, any class). Same idea as
// lessonPlanContentRoutes.js: each caller supplies its own auth
// middleware, how to load a class the user may manage, and the page
// chrome (view name + back link). See utils/substitutePlans.js.
const multer = require('multer');
const { lessonAttachmentFileFilter } = require('../utils/uploads');
const {
  fieldsFromBody,
  substitutePlansForClass,
  getSubstitutePlan,
  createSubstitutePlan,
  updateSubstitutePlan,
  deleteSubstitutePlan,
} = require('../utils/substitutePlans');

const MAX_WORKSHEET_BYTES = 10 * 1024 * 1024;
const worksheetUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_WORKSHEET_BYTES }, fileFilter: lessonAttachmentFileFilter });

// pathFor(classId) -> this class's substitute plan page URL.
// loadClass(req) -> the class (with class_name) or null when this user
// can't manage it; onForbidden(res) renders the refusal.
function mountSubstitutePlanRoutes(router, { pathPrefix, middleware, pathFor, loadClass, onForbidden, view, viewLocals }) {
  const back = (classId, params) => pathFor(classId) + (params ? '?' + new URLSearchParams(params).toString() : '');

  function uploadWorksheet(req, res, next) {
    worksheetUpload.single('worksheet')(req, res, (err) => {
      if (err && err.code === 'LIMIT_FILE_SIZE') {
        return res.redirect(back(req.params.id, { error: `That file is too large - worksheets are limited to ${MAX_WORKSHEET_BYTES / (1024 * 1024)}MB.` }));
      }
      next(err);
    });
  }

  async function planForClass(req, cls) {
    const plan = await getSubstitutePlan(parseInt(req.params.planId, 10));
    return plan && plan.class_id === cls.id ? plan : null;
  }

  router.get(`${pathPrefix}/:id/substitute-plan`, ...middleware, async (req, res) => {
    const cls = await loadClass(req);
    if (!cls) return onForbidden(res);
    res.render(view, {
      title: `${cls.class_name} Substitute Plans`,
      cls,
      plans: await substitutePlansForClass(cls.id),
      basePath: pathFor(cls.id),
      openPlanId: req.query.open ? parseInt(req.query.open, 10) : null,
      notice: req.query.notice || null,
      error: req.query.error || null,
      ...(viewLocals ? await viewLocals(req, cls) : {}),
    });
  });

  router.post(`${pathPrefix}/:id/substitute-plan`, ...middleware, uploadWorksheet, async (req, res) => {
    const cls = await loadClass(req);
    if (!cls) return onForbidden(res);
    const fields = fieldsFromBody(req.body);
    if (!fields.title) return res.redirect(back(cls.id, { error: 'A substitute plan title is required.' }));
    const id = await createSubstitutePlan({ classId: cls.id, ...fields, file: req.file || null, accountId: req.portalAccount ? req.portalAccount.id : null });
    res.redirect(back(cls.id, { open: id, notice: `"${fields.title}" added.` }));
  });

  router.post(`${pathPrefix}/:id/substitute-plan/:planId`, ...middleware, uploadWorksheet, async (req, res) => {
    const cls = await loadClass(req);
    if (!cls) return onForbidden(res);
    const plan = await planForClass(req, cls);
    if (!plan) return res.redirect(back(cls.id, { error: 'That substitute plan no longer exists.' }));
    const fields = fieldsFromBody(req.body);
    if (!fields.title) return res.redirect(back(cls.id, { open: plan.id, error: 'A substitute plan title is required.' }));
    await updateSubstitutePlan(plan, { ...fields, file: req.file || null, removeWorksheet: req.body.removeWorksheet === '1' });
    res.redirect(back(cls.id, { open: plan.id, notice: `"${fields.title}" saved.` }));
  });

  router.post(`${pathPrefix}/:id/substitute-plan/:planId/delete`, ...middleware, async (req, res) => {
    const cls = await loadClass(req);
    if (!cls) return onForbidden(res);
    const plan = await planForClass(req, cls);
    if (plan) await deleteSubstitutePlan(plan);
    res.redirect(back(cls.id, plan ? { notice: `"${plan.title}" deleted.` } : null));
  });
}

module.exports = { mountSubstitutePlanRoutes };
