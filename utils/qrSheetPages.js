// A real bug report (photos of a printed Room 5 Wednesday sheet with QR
// cards overlapping each other and the next page's header): the class
// QR print sheet put every class a room has that day on ONE fixed 2x2,
// 8.5x11in page, assuming hour_position capped a room at 4 classes per
// day - but per-semester schedules can put more than 4 in one room/day,
// and the extras overflowed onto the next printed page. Splits any
// (day, room) group into pages of at most 4, each keeping the same
// room/day header.
const QR_CELLS_PER_PAGE = 4;

function chunkQrPages(pages) {
  const out = [];
  for (const page of pages) {
    if (page.classes.length <= QR_CELLS_PER_PAGE) {
      out.push(page);
      continue;
    }
    for (let i = 0; i < page.classes.length; i += QR_CELLS_PER_PAGE) {
      out.push({ ...page, classes: page.classes.slice(i, i + QR_CELLS_PER_PAGE) });
    }
  }
  return out;
}

module.exports = { chunkQrPages, QR_CELLS_PER_PAGE };
