const { fileResourceRouter } = require('../lib/fileResource');

// NDA tracking — counterparty, dates, status + an optional signed document.
module.exports = fileResourceRouter({
  table: 'ndas',
  prefix: 'ndas',
  required: 'counterparty',
  fields: ['counterparty', 'status', 'effective_date', 'expiration_date', 'notes', 'file_name', 'r2_key'],
});
