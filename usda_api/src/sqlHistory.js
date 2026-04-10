class SqlHistory {
  constructor(maxSize) {
    this.maxSize = maxSize;
    this.items = [];
  }

  add(e) {
    this.items.unshift(e);
    if (this.items.length > this.maxSize) {
      this.items.length = this.maxSize;
    }
  }

  all() {
    return this.items;
  }

  clear() {
    this.items = [];
  }
}

module.exports = { SqlHistory };
