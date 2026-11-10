// Saved orders of service. A template with a service name is used automatically for new plans of
// services with that name; any template can also be added to a plan by hand.
import { Router } from 'express';
import { OrderTemplate } from '../models.js';
import { requirePerm } from '../auth.js';
import { bad, isId, notFound, str, wrap } from '../lib/util.js';
import { orderView, readOrder } from '../lib/serviceOrder.js';

export const templatesRouter = Router();

const view = (t) => ({ id: String(t._id), name: t.name, serviceTitle: t.serviceTitle, order: orderView(t.order) });

templatesRouter.get('/', wrap(async (req, res) => {
  res.json((await OrderTemplate.find({}).sort({ name: 1 })).map(view));
}));

// POST { name, serviceTitle, order } — a template with the same name is replaced
templatesRouter.post('/', requirePerm('plans'), wrap(async (req, res) => {
  const b = req.body || {};
  const name = str(b.name, 80);
  if (!name) throw bad('Name the template.');
  const order = readOrder(b.order);
  if (!order.length) throw bad('The order of service is empty.');
  const serviceTitle = str(b.serviceTitle, 120);
  if (serviceTitle) await OrderTemplate.updateMany({ serviceTitle, name: { $ne: name } }, { serviceTitle: '' }); // one automatic template per service name
  let t = await OrderTemplate.findOne({ name });
  const created = !t;
  t ||= new OrderTemplate({ name, createdBy: req.user._id });
  t.serviceTitle = serviceTitle;
  t.order = order;
  await t.save();
  res.locals.activity = `${created ? 'Saved' : 'Updated'} the order-of-service template “${name}”`;
  res.status(created ? 201 : 200).json(view(t));
}));

templatesRouter.patch('/:id', requirePerm('plans'), wrap(async (req, res) => {
  if (!isId(req.params.id)) throw notFound();
  const t = await OrderTemplate.findById(req.params.id);
  if (!t) throw notFound();
  if (req.body.name !== undefined) t.name = str(req.body.name, 80) || t.name;
  if (req.body.serviceTitle !== undefined) {
    t.serviceTitle = str(req.body.serviceTitle, 120);
    if (t.serviceTitle) await OrderTemplate.updateMany({ serviceTitle: t.serviceTitle, _id: { $ne: t._id } }, { serviceTitle: '' });
  }
  await t.save();
  res.json(view(t));
}));

templatesRouter.delete('/:id', requirePerm('plans'), wrap(async (req, res) => {
  if (!isId(req.params.id)) throw notFound();
  const t = await OrderTemplate.findByIdAndDelete(req.params.id);
  if (t) res.locals.activity = `Deleted the order-of-service template “${t.name}”`;
  res.status(204).end();
}));
