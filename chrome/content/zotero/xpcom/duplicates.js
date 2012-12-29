/*
    ***** BEGIN LICENSE BLOCK *****
    
    Copyright © 2009 Center for History and New Media
                     George Mason University, Fairfax, Virginia, USA
                     http://zotero.org
    
    This file is part of Zotero.
    
    Zotero is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.
    
    Zotero is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.
    
    You should have received a copy of the GNU Affero General Public License
    along with Zotero.  If not, see <http://www.gnu.org/licenses/>.
    
    ***** END LICENSE BLOCK *****
*/

Zotero.Duplicates = function (libraryID) {
	if (typeof libraryID == 'undefined') {
		throw ("libraryID not provided in Zotero.Duplicates constructor");
	}
	
	if (!libraryID) {
		libraryID = null;
	}
	
	this._libraryID = libraryID;
}


Zotero.Duplicates.prototype.__defineGetter__('name', function () Zotero.getString('pane.collections.duplicate'));
Zotero.Duplicates.prototype.__defineGetter__('libraryID', function () this._libraryID);


/**
 * Get duplicates, populate a temporary table, and return a search based
 * on that table
 *
 * @return {Zotero.Search}
 */
Zotero.Duplicates.prototype.getSearchObject = function () {
	Zotero.DB.beginTransaction();
	
	var sql = "DROP TABLE IF EXISTS tmpDuplicates";
	Zotero.DB.query(sql);
	
	var sql = "CREATE TEMPORARY TABLE tmpDuplicates "
				+ "(id INTEGER PRIMARY KEY)";
	Zotero.DB.query(sql);
	
	this._findDuplicates();
	var ids = this._sets.findAll(true);
	
	sql = "INSERT INTO tmpDuplicates VALUES (?)";
	var insertStatement = Zotero.DB.getStatement(sql);
	
	for each(var id in ids) {
		insertStatement.bindInt32Parameter(0, id);
		
		try {
			insertStatement.execute();
		}
		catch(e) {
			throw (e + ' [ERROR: ' + Zotero.DB.getLastErrorString() + ']');
		}
	}
	
	Zotero.DB.commitTransaction();
	
	var s = new Zotero.Search;
	s.libraryID = this._libraryID;
	s.addCondition('tempTable', 'is', 'tmpDuplicates');
	return s;
}


/**
 * Finds all items in the same set as a given item
 *
 * @param {Integer} itemID
 * @return {Integer[]}  Array of itemIDs
 */
Zotero.Duplicates.prototype.getSetItemsByItemID = function (itemID) {
	return this._sets.findAllInSet(this._getObjectFromID(itemID), true);
}


Zotero.Duplicates.prototype._getObjectFromID = function (id) {
	return {
		get id() { return id; }
	}
}


Zotero.Duplicates.prototype._findDuplicates = function () {
	var start = Date.now();
	
	var self = this;
	
	this._sets = new Zotero.DisjointSetForest;
	var sets = this._sets;
	
	function normalizeString(str) {
		// Make sure we have a string and not an integer
		str = str + "";
		
		if (str === "") {
			return "";
		}
		
		str = Zotero.Utilities.removeDiacritics(str)
			.replace(/[!-/:-@[-`{-~]/g, ' ') // Convert (ASCII) punctuation to spaces
			.replace(/ +/, ' ') // Normalize spaces
			.toLowerCase();
		
		return str;
	}
	
	/**
	 * @param {Function} compareRows  Comparison function, if not exact match
	 * @param {Boolean} reprocessMatches  Compare every row against every other,
	 *                                    without skipping ahead to the last match.
	 *                                    This is necessary for multi-dimensional
	 *                                    matches such as title + at least one creator.
	 *                                    Without it, only one set of matches would be
	 *                                    found per matching title, since items with
	 *                                    different creators wouldn't match the first
	 *                                    set and the next start row would be a
	 *                                    different title.
	 */
	function processRows(compareRows, reprocessMatches) {
		if (!rows) {
			return;
		}
		
		for (var i = 0, len = rows.length; i < len; i++) {
			var j = i + 1, lastMatch = false;
			while (j < len) {
				if (compareRows) {
					var match = compareRows(rows[i], rows[j]);
					// Not a match, and don't try any more with this i value
					if (match == -1) {
						break;
					}
					// Not a match, but keep looking
					if (match == 0) {
						j++;
						continue;
					}
				}
				// If no comparison function, check for exact match
				else {
					if (rows[i].value !== rows[j].value) {
						break;
					}
				}
				
				sets.union(
					self._getObjectFromID(rows[i].itemID),
					self._getObjectFromID(rows[j].itemID)
				);
				
				lastMatch = j;
				j++;
			}
			if (!reprocessMatches && lastMatch) {
				i = lastMatch;
			}
		}
	}
	
	// Match books by ISBN
	var sql = "SELECT itemID, value FROM items JOIN itemData USING (itemID) "
				+ "JOIN itemDataValues USING (valueID) "
				+ "WHERE libraryID=? AND itemTypeID=? AND fieldID=? "
				+ "AND itemID NOT IN (SELECT itemID FROM deletedItems) "
				+ "ORDER BY value";
	var rows = Zotero.DB.query(
		sql,
		[
			this._libraryID,
			Zotero.ItemTypes.getID('book'),
			Zotero.ItemFields.getID('ISBN')
		]
	);
	var isbnCache = {};
	if (rows) {
		for each(var row in rows) {
			isbnCache[row.itemID] = row.value;
		}
	}
	processRows();
	
	// DOI
	var sql = "SELECT itemID, value FROM items JOIN itemData USING (itemID) "
				+ "JOIN itemDataValues USING (valueID) "
				+ "WHERE libraryID=? AND fieldID=? AND REGEXP('^10\.', value) "
				+ "AND itemID NOT IN (SELECT itemID FROM deletedItems) "
				+ "ORDER BY value";
	var rows = Zotero.DB.query(sql, [this._libraryID, Zotero.ItemFields.getID('DOI')]);
	var doiCache = {};
	if (rows) {
		for each(var row in rows) {
			doiCache[row.itemID] = row.value;
		}
	}
	processRows();
	
	// For legal types we ignore the title but we're fussy about other stuff
	//
	// 15 = section
	// 36 = code
	// 43 = reporter
	// 44 = court
	// 55 = codeNumber
	// 60 = number
	// 93 = billNumber
	// 94 = codeVolume
	// 97 = reporterVolume
	// 98 = firstPage
	// 101 = publicLawNumber
    // 117 = docketNumber
	//
	var sql = "SELECT itemID, group_concat(itemDataValues.value, '::') as value FROM items JOIN itemData USING (itemID) "
				+ "JOIN itemDataValues USING (valueID) "
				+ "WHERE libraryID=? AND fieldID IN (15, 36, 43, 44, 55, 60, 93, 94, 97, 98, 101, 117) "
				+ "AND itemTypeID IN (16, 17, 20) "
				+ "AND itemID NOT IN (SELECT itemID FROM deletedItems) "
                + "GROUP BY itemID "
				+ "ORDER BY itemDataValues.value COLLATE locale";
	var rows = Zotero.DB.query(sql, [this._libraryID]);
	processRows();

	// Get years
	var dateFields = [Zotero.ItemFields.getID('date')].concat(
		Zotero.ItemFields.getTypeFieldsFromBase('date')
	);
	var sql = "SELECT itemID, SUBSTR(value, 1, 4) AS year FROM items "
				+ "JOIN itemData USING (itemID) "
				+ "JOIN itemDataValues USING (valueID) "
				+ "WHERE libraryID=? AND fieldID IN ("
				+ dateFields.map(function () '?').join() + ") "
				+ "AND SUBSTR(value, 1, 4) != '0000' "
				+ "AND itemID NOT IN (SELECT itemID FROM deletedItems) "
				+ "ORDER BY value";
	var rows = Zotero.DB.query(sql, [this._libraryID].concat(dateFields));
	var yearCache = {};
	if (rows) {
		for each(var row in rows) {
			yearCache[row.itemID] = row.year;
		}
	}
	
	var creatorRowsCache = {};
	// Match on normalized title
	// Return NULL if no title, otherwise catenate title and edition
	// 
	// 6 = edition
	// 5 = issue
	var sql = "SELECT itemID, CASE "
				+ "WHEN maxID>6 THEN realvalue "
				+ "ELSE NULL "
			+ "END as checkvalue "
			+ "FROM (SELECT itemID, max(fieldID) AS maxID, group_concat(value, '::') AS realvalue "
				+ "FROM items JOIN itemData USING (itemID) "
				+ "JOIN itemDataValues USING (valueID) "
				+ "WHERE libraryID=? AND fieldID in (5, 6, 110, 111, 112, 113) "
				+ "AND itemTypeID NOT IN (1, 14, 16, 17, 20) "
				+ "AND itemID NOT IN (SELECT itemID FROM deletedItems) "
				+ "GROUP BY itemID) "
			+ "ORDER BY checkvalue COLLATE locale";
	var rows = Zotero.DB.query(sql, [this._libraryID]);

	processRows(function (a, b) {
		var aTitle = normalizeString(a.checkvalue);
		var bTitle = normalizeString(b.checkvalue);
		
		// If we stripped one of the strings completely, we can't compare them
		if (aTitle.length == 0 || bTitle.length == 0) {
			return -1;
		}
		
		if (aTitle !== bTitle) {
			return -1;
		}
		
		// If both items have a DOI and they don't match, it's not a dupe
		if (typeof doiCache[a.itemID] != 'undefined'
				&& typeof doiCache[b.itemID] != 'undefined'
				&& doiCache[a.itemID] != doiCache[b.itemID]) {
			return -1;
		}
		
		// If both items have an ISBN and they don't match, it's not a dupe
		if (typeof isbnCache[a.itemID] != 'undefined'
				&& typeof isbnCache[b.itemID] != 'undefined'
				&& isbnCache[a.itemID] != isbnCache[b.itemID]) {
			return -1;
		}
		
		// If both items have a year and they're off by more than one, it's not a dupe
		if (typeof yearCache[a.itemID] != 'undefined'
				&& typeof yearCache[b.itemID] != 'undefined'
				&& Math.abs(yearCache[a.itemID] - yearCache[b.itemID]) > 1) {
			return -1;
		}
		
		// Check for at least one match on last name + first initial of first name
		if (typeof creatorRowsCache[a.itemID] != 'undefined') {
			aCreatorRows = creatorRowsCache[a.itemID];
		}
		else {
			var sql = "SELECT lastName, firstName, fieldMode FROM itemCreators "
						+ "JOIN creators USING (creatorID) "
						+ "JOIN creatorData USING (creatorDataID) "
						+ "WHERE itemID=? ORDER BY orderIndex LIMIT 10";
			var aCreatorRows = Zotero.DB.query(sql, a.itemID);
			creatorRowsCache[a.itemID] = aCreatorRows;
		}
		
		// Check for at least one match on last name + first initial of first name
		if (typeof creatorRowsCache[b.itemID] != 'undefined') {
			bCreatorRows = creatorRowsCache[b.itemID];
		}
		else {
			var sql = "SELECT lastName, firstName, fieldMode FROM itemCreators "
						+ "JOIN creators USING (creatorID) "
						+ "JOIN creatorData USING (creatorDataID) "
						+ "WHERE itemID=? ORDER BY orderIndex LIMIT 10";
			var bCreatorRows = Zotero.DB.query(sql, b.itemID);
			creatorRowsCache[b.itemID] = bCreatorRows;
		}
		
		// Match if no creators
		if (!aCreatorRows && !bCreatorRows.length) {
			return 1;
		}
		
		if (!aCreatorRows || !bCreatorRows) {
			return 0;
		}
		
		for each(var aCreatorRow in aCreatorRows) {
			var aLastName = normalizeString(aCreatorRow.lastName);
			var aFirstInitial = aCreatorRow.fieldMode == 0 ? normalizeString(aCreatorRow.firstName.substr(1)) : false;
			
			for each(var bCreatorRow in bCreatorRows) {
				var bLastName = normalizeString(bCreatorRow.lastName);
				var bFirstInitial = bCreatorRow.fieldMode == 0 ? normalizeString(bCreatorRow.firstName.substr(1)) : false;
				
				if (aLastName === bLastName && aFirstInitial === bFirstInitial) {
					return 1;
				}
			}
		}
		
		return 0;
	}, true);
	
	// Match on exact fields
	/*var fields = [''];
	for each(var field in fields) {
		var sql = "SELECT itemID, value FROM items JOIN itemData USING (itemID) "
					+ "JOIN itemDataValues USING (valueID) "
					+ "WHERE libraryID=? AND fieldID=? "
					+ "AND itemID NOT IN (SELECT itemID FROM deletedItems) "
					+ "ORDER BY value";
		var rows = Zotero.DB.query(sql, [this._libraryID, Zotero.ItemFields.getID(field)]);
		processRows();
	}*/
	
	Zotero.debug("Found duplicates in " + (Date.now() - start) + " ms");
}



/**
 * Implements the Disjoint Set data structure
 *
 *  Based on pseudo-code from http://en.wikipedia.org/wiki/Disjoint-set_data_structure
 *
 * Objects passed should have .id properties that uniquely identify them
 */

Zotero.DisjointSetForest = function () {
	this._objects = {};
}

Zotero.DisjointSetForest.prototype.find = function (x) {
	var id = x.id;
	
	// If we've seen this object before, use the existing copy,
	// which will have .parent and .rank properties
	if (this._objects[id]) {
		var obj = this._objects[id];
	}
	// Otherwise initialize it as a new set
	else {
		this._makeSet(x);
		this._objects[id] = x;
		var obj = x;
	}
	
	if (obj.parent.id == obj.id) {
		return obj;
	}
	else {
		obj.parent = this.find(obj.parent);
		return obj.parent;
	}
}


Zotero.DisjointSetForest.prototype.union = function (x, y) {
	var xRoot = this.find(x);
	var yRoot = this.find(y);
	
	// Already in same set
	if (xRoot.id == yRoot.id) {
		return;
	}
	
	if (xRoot.rank < yRoot.rank) {
		xRoot.parent = yRoot;
	}
	else if (xRoot.rank > yRoot.rank) {
		yRoot.parent = xRoot;
	}
	else {
		yRoot.parent = xRoot;
		xRoot.rank = xRoot.rank + 1;
	}
}


Zotero.DisjointSetForest.prototype.sameSet = function (x, y) {
    return this.find(x) == this.find(y);
}


Zotero.DisjointSetForest.prototype.findAll = function (asIDs) {
	var objects = [];
	for each(var obj in this._objects) {
		objects.push(asIDs ? obj.id : obj);
	}
	return objects;
}


Zotero.DisjointSetForest.prototype.findAllInSet = function (x, asIDs) {
	var xRoot = this.find(x);
	var objects = [];
	for each(var obj in this._objects) {
		if (this.find(obj) == xRoot) {
			objects.push(asIDs ? obj.id : obj);
		}
	}
	return objects;
}


Zotero.DisjointSetForest.prototype._makeSet = function (x) {
	x.parent = x;
	x.rank = 0;
}
