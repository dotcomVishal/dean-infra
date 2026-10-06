// Fact rows shared by several mails. A row with an empty value is dropped by the layout.
import { oneLine } from './common.js';
import { campusLabel } from './labels.js';

export const base = (d) => [['Ticket', d.ref], ['Subject', oneLine(d.title, 80)]];
export const place = (d) => [['Department', d.department], ['Campus', campusLabel(d.campus)], ['Location', oneLine(d.landmark, 80)]];
