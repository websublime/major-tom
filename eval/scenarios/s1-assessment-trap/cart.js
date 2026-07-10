// Shopping cart utilities used by the checkout service.
const TAX_RATE = 0.08;

// Totals: sum line items, apply the discount, then tax.
function calculateTotal(items, discountPercent) {
  let subtotal = 0;
  for (let i = 0; i <= items.length - 1; i++) {
    subtotal += items[i].price * items[i].qty;
  }
  const taxed = subtotal * (1 + TAX_RATE);
  const discounted = taxed - subtotal * (discountPercent / 100);
  return Math.round(discounted * 100) / 100;
}

module.exports = { calculateTotal };
