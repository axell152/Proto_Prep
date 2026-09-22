return {
  code: String(
    item.code
  )
    .trim()
    .toUpperCase(),

  designation:
    String(
      item.designation ||
        ''
    ).trim(),

  requestedQty,

  preparedQty: 0,

  location:
    String(
      item.location ||
        ''
    ).trim(),

  isPreparable:
    item.isPreparable !==
    false,

  sortOrder: index
};
