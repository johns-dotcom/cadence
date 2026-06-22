const { fileResourceRouter } = require('../lib/fileResource');

// Secure document vault — categorised company documents with optional files.
module.exports = fileResourceRouter({
  table: 'admin_docs',
  prefix: 'admin-docs',
  required: 'title',
  gate: 'admin',
  fields: [
    'title', 'category', 'status', 'confidentiality', 'counterparty',
    'signed_date', 'expiration_date', 'tags', 'notes', 'file_name', 'r2_key',
  ],
});
