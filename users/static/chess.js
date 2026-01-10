//filename: chess.js
//author: Jack Abram
//description: JavaScript file to handle chess game logic and interactions

//Enum for piece colors
const PieceColor = Object.freeze({
    WHITE: 0,
    BLACK: 1,
    EMPTY: 2, // Represents empty square
    Error: 3 // Error handling
});

// Utility to get CSRF token from cookie (used for AJAX POSTs)
function _getCsrfTokenFromCookie() {
    if (typeof document === 'undefined' || !document.cookie) return '';
    const name = 'csrftoken';
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return '';
}

// Removed showGameOverBanner: endgame messages are written to the in-page console via writeConsole()

//Enum for piece types
const PieceType = Object.freeze({
    PAWN: 0,
    ROOK: 1,
    KNIGHT: 2,
    BISHOP: 3,
    QUEEN: 4,
    KING: 5,
    EMPTY: 6, // Represents empty square
    Error: 7 // Error handling
});

//Class representing a chess piece
class ChessPiece {
    constructor(color = PieceColor.EMPTY, type = PieceType.EMPTY) {
        if (color == PieceColor.EMPTY && type != PieceType.EMPTY) { throw new Error("Invalid piece: non-empty type with empty color"); }    
        if (type == PieceType.EMPTY && color != PieceColor.EMPTY) { throw new Error("Invalid piece: non-empty color with empty type"); }
        if (color == PieceColor.Error || type == PieceType.Error) { throw new Error("Invalid piece: color or type set to Error"); }
        this.color = color; // Piece color
        this.type = type; // Piece type
        this.enpassantEligible = false; // For pawns that can be captured en passant
        this.moved = false; // To track if the piece has moved (important for castling and pawn moves)
        this.board = []; // Placeholder for board reference
        this.row = -1; // Placeholder for piece row
        this.col = -1; // Placeholder for piece column
        this.short_color = ' '; // 'W', 'B', or ' ' for empty
        this.short_type = ' '; // 'P', 'R', 'N', 'B', 'Q', 'K', or ' ' for empty
        this.locations = []; //Locations this piece can move to
        if (this.color == PieceColor.WHITE) {
            this.short_color = 'W';
        }
        else if (this.color == PieceColor.BLACK) {
            this.short_color = 'B';
        }
    }
    see_board(board, row, col) {
        // Method to set the board reference and piece position
        this.board = board; // Reference to the board
        this.row = row; // Piece's row position
        this.col = col; // Piece's column position
    }
    get_moveable_squares() {
        // Placeholder method to be overridden by subclasses
        throw new Error("get_moveable_squares() not implemented for base ChessPiece class");
    }
    equals(otherPiece) {
        // Method to compare two pieces
        if (!(otherPiece instanceof ChessPiece)) { return false; }
        return this.color == otherPiece.color && this.type == otherPiece.type && this.enpassantEligible == otherPiece.enpassantEligible && this.moved == otherPiece.moved && this.row == otherPiece.row && this.col == otherPiece.col;
    }
    other_color() {
        // Method to get the opposite color
        if (this.color == PieceColor.WHITE) { return PieceColor.BLACK;  }
        else if (this.color == PieceColor.BLACK) { return PieceColor.WHITE;  }
        else { throw new Error("No opposite color for EMPTY or Error pieces"); }
    }
    toString() {
        return this.short_color + this.short_type;
    }
    // Return the Unicode chess character for this piece (single-character string).
    // White pieces: U+2654..U+2659, Black pieces: U+265A..U+265F
    unicodeChar() {
        if (this.type == PieceType.EMPTY) { return ' '; }
        if (this.color == PieceColor.WHITE) {
            switch (this.type) {
                case PieceType.KING: return '\u2654';
                case PieceType.QUEEN: return '\u2655';
                case PieceType.ROOK: return '\u2656';
                case PieceType.BISHOP: return '\u2657';
                case PieceType.KNIGHT: return '\u2658';
                case PieceType.PAWN: return '\u2659';
                default: return ' ';
            }
        }
        else if (this.color == PieceColor.BLACK) {
            switch (this.type) {
                case PieceType.KING: return '\u265A';
                case PieceType.QUEEN: return '\u265B';
                case PieceType.ROOK: return '\u265C';
                case PieceType.BISHOP: return '\u265D';
                case PieceType.KNIGHT: return '\u265E';
                case PieceType.PAWN: return '\u265F';
                default: return ' ';
            }
        }
        return ' ';
    }
}
// Class for Square on board
class Square {
    constructor(row, col) {
        this.row = row;
        this.col = col;
        this.piece = new NullPiece(); // Default to empty piece
    }
    toString() {
        return this.piece.toString();
    }
    // Method to print location in standard chess notation (e.g., 'A1', 'E5')
    print_loc() {
        return `${String.fromCharCode(65+this.col)}${this.row+1}`;
    }
    //under attack method
    is_under_attack(board, color) {
        // Placeholder method to determine if square is under attack by pieces of the opposite color
        if (!(color == PieceColor.WHITE || color == PieceColor.BLACK)) { throw new Error("Invalid color for is_under_attack"); }
        let other_color = color == PieceColor.WHITE ? PieceColor.BLACK : PieceColor.WHITE;
        for (let i = 0; i < board.length; i++) {
            for (let j = 0; j < board[i].length; j++) {
                const p = board[i][j].piece;
                if (p.color == other_color) {
                    // Defensive: ensure piece has a valid board reference and coordinates
                    if (!p || !p.get_moveable_squares || !Array.isArray(p.board) || typeof p.row !== 'number' || typeof p.col !== 'number') {
                        try {
                            if (typeof console !== 'undefined') {
                                const info = {
                                    index_i: i,
                                    index_j: j,
                                    constructor: p && p.constructor ? p.constructor.name : null,
                                    type: p && p.type != null ? p.type : null,
                                    color: p && p.color != null ? p.color : null,
                                    row: p && typeof p.row === 'number' ? p.row : null,
                                    col: p && typeof p.col === 'number' ? p.col : null,
                                    hasBoardRef: !!(p && p.board),
                                    boardLen: p && p.board ? p.board.length : null
                                };
                                console.error('Skipping uninitialized piece in is_under_attack', info, new Error().stack);
                            }
                        } catch (e) {}
                        continue;
                    }
                    let moves = [];
                    try {
                        moves = p.get_moveable_squares() || [];
                    } catch (err) {
                        try {
                            if (typeof console !== 'undefined') {
                                const ctx = {
                                    board_i: i,
                                    board_j: j,
                                    constructor: p && p.constructor ? p.constructor.name : null,
                                    type: p && p.type != null ? p.type : null,
                                    color: p && p.color != null ? p.color : null,
                                    row: p && typeof p.row === 'number' ? p.row : null,
                                    col: p && typeof p.col === 'number' ? p.col : null,
                                    boardLen: p && p.board ? p.board.length : null
                                };
                                console.error('Error in get_moveable_squares for piece during is_under_attack, skipping piece', ctx, err && err.stack ? err.stack : err);
                            }
                        } catch (e) {}
                        continue;
                    }
                    for (let k = 0; k < moves.length; k++) {
                        if (moves[k] && moves[k].row == this.row && moves[k].col == this.col) {
                            return true;
                        }
                    }
                }
            }
        }
        return false;
    }
    get_html_id() {
        // gets html_id for square
        return `${String.fromCharCode(97 + this.col)}${this.row + 1}`;
    }
}
// Null Piece class
class NullPiece extends ChessPiece {
    constructor() {
        super();
    }
    get_moveable_squares() {
        this.locations = [];
        return [];
    }
    toString() {
        return "  ";
    }
}
//King Piece Class
class King extends ChessPiece {
    constructor(color) {
        super(color, PieceType.KING);
        this.short_type = 'K';
    }
    get_moveable_squares() {
        let moves = [];
        let directions = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
        for (let dir of directions) {
            let newRow = this.row + dir[0];
            let newCol = this.col + dir[1];
            if (newRow >= 0 && newRow < 8 && newCol >= 0 && newCol < 8) {
                let targetSquare = this.board[newRow][newCol];
                if (targetSquare.piece.color != this.color){
                    moves.push(targetSquare);
                }
            }
        }

        if (!this.moved) { // Castling logic
            const opponent = this.other_color();

            // helper: is square (r,c) under attack by color
            const isSquareUnderAttackBy = (r, c, color) => {
                for (let i = 0; i < 8; i++) {
                    for (let j = 0; j < 8; j++) {
                        let p = this.board[i][j].piece;
                        if (p.color == color) {
                            // get_moveable_squares should return array of Square objects
                            let pMoves = p.get_moveable_squares();
                            for (let m of pMoves) {
                                if (m.row == r && m.col == c) { return true; }
                            }
                        }
                    }
                }
                return false;
            };

            // Find rook to the right (king-side)
            let rookRight = -1;
            for (let col = this.col + 1; col < 8; col++) {
                let piece = this.board[this.row][col].piece;
                if (piece.type == PieceType.ROOK && piece.color == this.color && !piece.moved) {
                    rookRight = col;
                    break;
                }
                // stop if blocked by any non-empty piece (can't castle past pieces)
                if (piece.type != PieceType.EMPTY) { break; }
            }

            if (rookRight != -1) {
                // ensure spaces between king and rook are empty
                let emptyBetween = true;
                for (let col = this.col + 1; col < rookRight; col++) {
                    if (this.board[this.row][col].piece.type != PieceType.EMPTY) { emptyBetween = false; break; }
                }
                if (emptyBetween) {
                    // king cannot be in check, pass through, or land on attacked square
                    let currentInCheck = isSquareUnderAttackBy(this.row, this.col, opponent);
                    let passThroughAttacked = isSquareUnderAttackBy(this.row, this.col + 1, opponent);
                    let destinationAttacked = isSquareUnderAttackBy(this.row, this.col + 2, opponent);
                    if (!currentInCheck && !passThroughAttacked && !destinationAttacked) {
                        moves.push(this.board[this.row][this.col + 2]);
                    }
                }
            }

            // Find rook to the left (queen-side)
            let rookLeft = -1;
            for (let col = this.col - 1; col >= 0; col--) {
                let piece = this.board[this.row][col].piece;
                if (piece.type == PieceType.ROOK && piece.color == this.color && !piece.moved) {
                    rookLeft = col;
                    break;
                }
                if (piece.type != PieceType.EMPTY) { break; }
            }

            if (rookLeft != -1) {
                // ensure spaces between rook and king are empty
                let emptyBetween = true;
                for (let col = rookLeft + 1; col < this.col; col++) {
                    if (this.board[this.row][col].piece.type != PieceType.EMPTY) { emptyBetween = false; break; }
                }
                if (emptyBetween) {
                    let currentInCheck = isSquareUnderAttackBy(this.row, this.col, opponent);
                    let passThroughAttacked = isSquareUnderAttackBy(this.row, this.col - 1, opponent);
                    let destinationAttacked = isSquareUnderAttackBy(this.row, this.col - 2, opponent);
                    if (!currentInCheck && !passThroughAttacked && !destinationAttacked) {
                        moves.push(this.board[this.row][this.col - 2]);
                    }
                }
            }
        }
        this.locations = moves;
        return moves;
    }
    toString() {
        return this.short_color + "K";
    }
}
//Pawn Piece Class
class Pawn extends ChessPiece {
    constructor(color) {
        super(color, PieceType.PAWN);
        this.short_type = 'P';
    }
    get_moveable_squares() {
        let moves = [];
        let direction = this.color == PieceColor.WHITE ? 1 : -1;
        // Forward move
        let forwardRow = this.row + direction;
        if (forwardRow >= 0 && forwardRow < 8) {
            if (this.board[forwardRow][this.col].piece.type == PieceType.EMPTY) {
                moves.push(this.board[forwardRow][this.col]);
                // Double move from starting position
                if (!this.moved) {
                    let doubleForwardRow = this.row + 2 * direction;
                    if (this.board[doubleForwardRow][this.col].piece.type == PieceType.EMPTY) {
                        moves.push(this.board[doubleForwardRow][this.col]);
                    }
                }
            }
            // Captures
            for (let dc of [-1, 1]) {
                let captureCol = this.col + dc;
                if (captureCol >= 0 && captureCol < 8) {
                    let targetSquare = this.board[forwardRow][captureCol];
                    // Normal diagonal capture — only test opponent color when a piece exists
                    if (targetSquare.piece && targetSquare.piece.type != PieceType.EMPTY && targetSquare.piece.other_color() == this.color) {
                        moves.push(targetSquare);
                    }
                    // En passant: capture pawn that just moved two squares
                    // The captured pawn sits on the current row, adjacent column
                    let adjacentSquare = this.board[this.row][captureCol];
                    if (adjacentSquare.piece.type == PieceType.PAWN && adjacentSquare.piece.color == this.other_color() && adjacentSquare.piece.enpassantEligible) {
                        // landing square must be empty
                        if (targetSquare.piece.type == PieceType.EMPTY) {
                            moves.push(targetSquare);
                        }
                    }
                }
            }
        }
        this.locations = moves;
        return moves;
    }
    toString() {
        return this.short_color + "P";
    }
}
//Rook Piece Class
class Rook extends ChessPiece {
    constructor(color) {
        super(color, PieceType.ROOK);
        this.short_type = 'R';
    }
    get_moveable_squares() {
        let moves = [];
        let directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        for (let dir of directions) {
            let newRow = this.row + dir[0];
            let newCol = this.col + dir[1];
            while (newRow >= 0 && newRow < 8 && newCol >= 0 && newCol < 8) {
                let targetSquare = this.board[newRow][newCol];
                if (targetSquare.piece.type == PieceType.EMPTY) {
                    moves.push(targetSquare);
                }
                else if (targetSquare.piece.other_color() == this.color) {
                    moves.push(targetSquare);
                    break;
                }
                else {
                    break;
                }
                newRow += dir[0];
                newCol += dir[1];
            }
        }
        this.locations = moves;
        return moves;
    }
    toString() {
        return this.short_color + "R";
    }
}
//Knight Piece Class
class Knight extends ChessPiece {
    constructor(color) {
        super(color, PieceType.KNIGHT);
        this.short_type = 'N';
    }
    get_moveable_squares() {
        let moves = [];
        let knightMoves = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
        for (let move of knightMoves) {
            let newRow = this.row + move[0];
            let newCol = this.col + move[1];
            if (newRow >= 0 && newRow < 8 && newCol >= 0 && newCol < 8) {
                if (this.board && this.board[newRow] && this.board[newRow][newCol]) {
                    let targetSquare = this.board[newRow][newCol];
                    if (targetSquare.piece && targetSquare.piece.color != this.color) {
                        moves.push(targetSquare);
                    }
                }
            }
        }
        this.locations = moves;
        return moves;
    }
    toString() {
        return this.short_color + "N";
    }
}
//Bishop Piece Class
class Bishop extends ChessPiece {
    constructor(color) {
        super(color, PieceType.BISHOP);
        this.short_type = 'B';
    }
    get_moveable_squares() {
        let moves = [];
        let directions = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
        for (let dir of directions) {
            let newRow = this.row + dir[0];
            let newCol = this.col + dir[1];
            while (newRow >= 0 && newRow < 8 && newCol >= 0 && newCol < 8) {
                let targetSquare = this.board[newRow][newCol];
                if (targetSquare.piece.type == PieceType.EMPTY) {
                    moves.push(targetSquare);
                }
                else if (targetSquare.piece.other_color() == this.color) {
                    moves.push(targetSquare);
                    break;
                }
                else {
                    break;
                }
                newRow += dir[0];
                newCol += dir[1];
            }
        }
        this.locations = moves;
        return moves;
    }
    toString() {
        return this.short_color + "B";
    }
}
//Queen Piece Class
class Queen extends ChessPiece {
    constructor(color) {
        super(color, PieceType.QUEEN);
        this.short_type = 'Q';
    }
    get_moveable_squares() {
        let moves = [];
        let directions = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
        for (let dir of directions) {
            let newRow = this.row + dir[0];
            let newCol = this.col + dir[1];
            while (newRow >= 0 && newRow < 8 && newCol >= 0 && newCol < 8) {
                let targetSquare = this.board[newRow][newCol];
                if (targetSquare.piece.type == PieceType.EMPTY) {
                    moves.push(targetSquare);
                }
                else if (targetSquare.piece.color != this.color) {
                    moves.push(targetSquare);
                    break;
                }
                else {
                    break;
                }
                newRow += dir[0];
                newCol += dir[1];
            }
        }
        this.locations = moves;
        return moves;
    }
    toString() {
        return this.short_color + "Q";
    }
}
// Board Class
class Board {
    constructor() {
        this.squares = [];
        for (let i = 0; i < 8; i++) {
            this.squares[i] = [];
            for (let j = 0; j < 8; j++) {
                this.squares[i][j] = new Square(i, j);
            }
        }
        this.white = null; // Placeholder for white player
        this.black = null; // Placeholder for black player
        this.user = null; // Placeholder for user player
        this.initialize_pieces();
        this.board_history = []; // To track board states for threefold repetition
        this.active_player = this.white; // To track whose turn it is
        this.move_count = 0; // To track number of moves for fifty-move rule
    }
    set_user(player) {
        //Sets the user player
        this.user = player;
    }
    initialize_pieces() {
        // Set up pieces on the board
        // Pawns
        for (let col = 0; col < 8; col++) {
            this.squares[1][col].piece = new Pawn(PieceColor.WHITE);
            this.squares[6][col].piece = new Pawn(PieceColor.BLACK);
        }
        // Back row pieces
        let back_row = [Rook, Knight, Bishop, Queen, King, Bishop, Knight, Rook];
        for (let col = 0; col < 8; col++) {
            this.squares[0][col].piece = new back_row[col](PieceColor.WHITE);
            this.squares[7][col].piece = new back_row[col](PieceColor.BLACK);
        }
    }
    initialize_pieces360_w() {
        if (this.user != this.white) {throw new Error("initialize_pieces360_w called but user is not white");}
        // Set up pieces on the board for chess360
        // Pawns
        for (let col = 0; col < 8; col++) {
            this.squares[1][col].piece = new Pawn(PieceColor.WHITE);
            this.squares[6][col].piece = new Pawn(PieceColor.BLACK);
        }
        // Back row pieces randomized
        let back_row = [null, null, null, null, null, null, null, null];
        let evenPositions = [0, 2, 4, 6];
        let oddPositions = [1, 3, 5, 7];
        // Place bishops on opposite color squares
        back_row[evenPositions[Math.floor(Math.random() * evenPositions.length)]] = new Bishop(PieceColor.WHITE);
        back_row[oddPositions[Math.floor(Math.random() * oddPositions.length)]] = new Bishop(PieceColor.WHITE);
        // remove used positions
        evenPositions = evenPositions.filter(pos => back_row[pos] == null);
        oddPositions = oddPositions.filter(pos => back_row[pos] == null);
        //Combine even and odd positions
        let availablePositions = evenPositions.concat(oddPositions);
        // Place queen
        let queenPosIndex = Math.floor(Math.random() * availablePositions.length);
        back_row[availablePositions[queenPosIndex]] = new Queen(PieceColor.WHITE);
        availablePositions.splice(queenPosIndex, 1);
        // Place knights
        for (let i = 0; i < 2; i++) {
            let knightPosIndex = Math.floor(Math.random() * availablePositions.length);
            back_row[availablePositions[knightPosIndex]] = new Knight(PieceColor.WHITE);
            availablePositions.splice(knightPosIndex, 1);
        }
        // Place rooks and king
        // Ensure king is between rooks
        availablePositions.sort((a, b) => a - b);
        back_row[availablePositions[0]] = new Rook(PieceColor.WHITE);
        back_row[availablePositions[1]] = new King(PieceColor.WHITE);
        back_row[availablePositions[2]] = new Rook(PieceColor.WHITE);
        // Place both back rows onto the board
        for (let col = 0; col < 8; col++) {
            this.squares[0][col].piece = back_row[col];
            this.squares[7][col].piece = new back_row[col].constructor(PieceColor.BLACK);
        }
    }
    initialize_pieces360_b(back_row) {
        //Takes an array of 8 white pieces representing the back row for chess360 and places them on the board for both white and black in that order.
        if (this.user != this.black) {throw new Error("initialize_pieces360_b called but user is not black");}
        // Set up pieces on the board for chess360
        // Pawns
        for (let col = 0; col < 8; col++) {
            this.squares[1][col].piece = new Pawn(PieceColor.WHITE);
            this.squares[6][col].piece = new Pawn(PieceColor.BLACK);
        }
        // Back row pieces from input
        for (let col = 0; col < 8; col++) {
            this.squares[0][col].piece = back_row[col];
            this.squares[7][col].piece = new back_row[col].constructor(PieceColor.BLACK);
        }
    }
    king_location(color) {
        // Method to find the king's location of a given color
        for (let i = 0; i < 8; i++) {
            for (let j = 0; j < 8; j++) {
                let piece = this.squares[i][j].piece;
                if (piece.type == PieceType.KING && piece.color == color) {
                    return this.squares[i][j];
                }
            }
        }
        throw new Error("King not found on the board");
    }
    see_board() {
        // Method to inform all pieces of the board state
        for (let i = 0; i < 8; i++) {
            for (let j = 0; j < 8; j++) {
                this.squares[i][j].piece.see_board(this.squares, i, j);
            }
        }
    }
    clone_board() {
        // Method to create a deep copy of the board
        let newBoard = new Board();
        for (let i = 0; i < 8; i++) {
            for (let j = 0; j < 8; j++) {
                let piece = this.squares[i][j].piece;
                if (piece.type == PieceType.EMPTY) {
                    newBoard.squares[i][j].piece = new NullPiece();
                    newBoard.squares[i][j].piece.see_board(newBoard.squares, i, j);
                }
                else {
                    let pieceClass = piece.constructor;
                    let newPiece = new pieceClass(piece.color);
                    newPiece.enpassantEligible = piece.enpassantEligible;
                    newPiece.moved = piece.moved;
                    newBoard.squares[i][j].piece = newPiece;
                    newBoard.squares[i][j].piece.see_board(newBoard.squares, i, j);
                }
            }
        }
        return newBoard;
    }
    clear_enpassant(color) {
        // Method to clear en passant eligibility for all pieces of a given color
        for (let i = 0; i < 8; i++) {
            for (let j = 0; j < 8; j++) {
                let piece = this.squares[i][j].piece;
                if (piece.color == color && piece.type == PieceType.PAWN) {
                    piece.enpassantEligible = false;
                }
            }
        }
    }
    handle_pawn_promotion(square, newType) {    
        // Method to handle pawn promotion
        if (square.piece.type == PieceType.PAWN && square.row % 7 == 0) {
            let color = square.piece.color;
            let promotedPiece;
            switch (newType) {
                case PieceType.QUEEN:
                    promotedPiece = new Queen(color);
                    break;
                case PieceType.ROOK:
                    promotedPiece = new Rook(color);
                    break;
                case PieceType.BISHOP:
                    promotedPiece = new Bishop(color);
                    break;
                case PieceType.KNIGHT:
                    promotedPiece = new Knight(color);
                    break;
                default:
                    throw new Error("Invalid piece type for promotion");
            }
            square.piece = promotedPiece;
            promotedPiece.see_board(this.squares, square.row, square.col);
            square.piece.moved = true;
        }
    }
    move_piece(fromSquare, toSquare) {
        // First handle castling: user's convention — `toSquare` is the rook's original square
        if (fromSquare.piece.type == PieceType.KING && toSquare.piece.color == fromSquare.piece.color) {
            const fromRow = fromSquare.row;
            const fromCol = fromSquare.col;

            if (toSquare.col > fromCol) {
                // Kingside: king -> 6, rook (toSquare) -> 5
                let kingDest = this.squares[fromRow][6];
                kingDest.piece = fromSquare.piece;
                fromSquare.piece = new NullPiece();
                kingDest.piece.moved = true;
                kingDest.piece.see_board(this.squares, kingDest.row, kingDest.col);

                let rookFrom = toSquare; // rook's original square
                let rookTo = this.squares[fromRow][5];
                rookTo.piece = rookFrom.piece;
                rookFrom.piece = new NullPiece();
                rookTo.piece.moved = true;
                rookTo.piece.see_board(this.squares, rookTo.row, rookTo.col);
            }
            else {
                // Queenside: king -> 2, rook (toSquare) -> 3
                let kingDest = this.squares[fromRow][2];
                kingDest.piece = fromSquare.piece;
                fromSquare.piece = new NullPiece();
                kingDest.piece.moved = true;
                kingDest.piece.see_board(this.squares, kingDest.row, kingDest.col);

                let rookFrom = toSquare; // rook's original square
                let rookTo = this.squares[fromRow][3];
                rookTo.piece = rookFrom.piece;
                rookFrom.piece = new NullPiece();
                rookTo.piece.moved = true;
                rookTo.piece.see_board(this.squares, rookTo.row, rookTo.col);
            }
            this.move_count += 1; // Increment fifty-move counter on castling
        }
        else if (fromSquare.piece.type == PieceType.PAWN && Math.abs(toSquare.row - fromSquare.row) == 2) {
            // Handle en passant eligibility
            toSquare.piece = fromSquare.piece;
            fromSquare.piece = new NullPiece();
            toSquare.piece.enpassantEligible = true;
            toSquare.piece.moved = true;
            toSquare.piece.see_board(this.squares, toSquare.row, toSquare.col);
            this.move_count = 0; // Reset fifty-move counter on pawn move
        }
        else if (fromSquare.piece.type == PieceType.PAWN && toSquare.col != fromSquare.col && toSquare.piece.type == PieceType.EMPTY) {
            // Handle en passant capture
            toSquare.piece = fromSquare.piece;
            fromSquare.piece = new NullPiece();
            let capturedPawnRow = fromSquare.row;
            let capturedPawnCol = toSquare.col;
            this.squares[capturedPawnRow][capturedPawnCol].piece = new NullPiece();
            toSquare.piece.moved = true;
            toSquare.piece.see_board(this.squares, toSquare.row, toSquare.col);
            this.move_count = 0; // Reset fifty-move counter on capture
        }
        else {
            // Reset fifty-move counter on capture or pawn move
            if (fromSquare.piece.type == PieceType.PAWN || toSquare.piece.type != PieceType.EMPTY) {
                this.move_count = 0;
            }
            else {
                this.move_count += 1;
            }
            // Normal move
            toSquare.piece = fromSquare.piece;
            fromSquare.piece = new NullPiece();
            toSquare.piece.moved = true;
            toSquare.piece.see_board(this.squares, toSquare.row, toSquare.col);
        }
        return;
    }
    check_for_check(color){
        // Method to check if the king of a given color is in check
        if (!(color == PieceColor.WHITE || color == PieceColor.BLACK)) { throw new Error("Invalid color for check_for_check"); }
        let kingSquare = this.king_location(color);
        return kingSquare.is_under_attack(this.squares,color);
    }
    check_legal_move(fromSquare, toSquare) {
        // Method to check if a move is legal (does not leave king in check)
        let simulatedBoard = this.clone_board();
        let simFromSquare = simulatedBoard.squares[fromSquare.row][fromSquare.col];
        let simToSquare = simulatedBoard.squares[toSquare.row][toSquare.col];
        simulatedBoard.move_piece(simFromSquare, simToSquare);
        return !simulatedBoard.check_for_check(fromSquare.piece.color);
    }
    remove_illegal_moves(color) {
        // Method to remove illegal moves for all pieces of a given color
        for (let i = 0; i < 8; i++) {
            for (let j = 0; j < 8; j++) {
                let piece = this.squares[i][j].piece;
                if (piece.color == color) {
                    let legalMoves = [];
                    let possibleMoves = piece.get_moveable_squares();
                    for (let move of possibleMoves) {
                        if (this.check_legal_move(this.squares[i][j], move)) {
                            legalMoves.push(move);
                        }
                    }
                    piece.locations = legalMoves;
                }
            }
        }
    }
    has_legal_moves(color) {
        // Method to check if any piece of a given color has legal moves
        this.remove_illegal_moves(color);
        for (let i = 0; i < 8; i++) {
            for (let j = 0; j < 8; j++) {
                let piece = this.squares[i][j].piece;
                if (piece.color == color && piece.locations.length > 0) {
                    return true;
                }
            }
        }
        return false;
    }
    set_player(player) {    
        //Adds player to an empty white or black at random
        if (this.white == null && this.black == null) {
            if (Math.random() < 0.5) {
                this.white = player;
            }
            else {
                this.black = player;
            }
        }
        else if (this.white == null) {
            this.white = player;
        }
        else if (this.black == null) {
            this.black = player;
        }
        else {
            throw new Error("Both player slots are already filled");
        }
    }
    checkmate_status() {
        // Method to check for checkmate of active player
        let color = this.active_player == this.white ? PieceColor.WHITE : PieceColor.BLACK;
        let inCheck = this.check_for_check(color);
        let hasMoves = this.has_legal_moves(color);
        return inCheck && !hasMoves;
    }
    stalemate_by_no_moves() {
        // Method to check for stalemate by seeing if active player has no legal moves and is not in check
        let color = this.active_player == this.white ? PieceColor.WHITE : PieceColor.BLACK;
        let inCheck = this.check_for_check(color);
        let hasMoves = this.has_legal_moves(color);
        return !inCheck && !hasMoves;
    }
    stalemate_by_50_move_rule() {
        // Method to check for stalemate by fifty-move rule
        return this.move_count >= 50;
    }
    actually_make_move(fromSquare, toSquare, promotionType = null) {
        // Method to actually make a move on the board
        this.move_piece(fromSquare, toSquare);
        // Handle pawn promotion
        if (toSquare.piece.type == PieceType.PAWN) {
            if ((toSquare.piece.color == PieceColor.WHITE && toSquare.row == 7) || (toSquare.piece.color == PieceColor.BLACK && toSquare.row == 0)) {
                if (promotionType == null) {
                    throw new Error("Pawn promotion type not specified");
                }
                this.handle_pawn_promotion(toSquare, promotionType);
            }
        }
        // Clear en passant eligibility for the other color
        this.clear_enpassant(toSquare.piece.other_color());
        // Update board history for threefold repetition
        let boardState = this.serialize_board();
        this.board_history.push(boardState);
        // Switch active player
        this.active_player = this.active_player == this.white ? this.black : this.white;
            // After making a move, check for endgame conditions and handle them
            try {
                // Determine color of the player to move (active_player)
                const colorToMove = (this.active_player == this.white) ? PieceColor.WHITE : PieceColor.BLACK;
                const inCheck = this.check_for_check(colorToMove);
                const hasMoves = this.has_legal_moves(colorToMove);
                console.log('Endgame check: colorToMove=', colorToMove, 'inCheck=', inCheck, 'hasLegalMoves=', hasMoves, 'move_count=', this.move_count);

                if (inCheck && !hasMoves) {
                    // Checkmate detected
                    const winner = (colorToMove == PieceColor.WHITE) ? this.black : this.white;
                    console.log('GAME OVER: Checkmate. Winner id/username:', winner && winner.id ? winner.id : '(unknown)', winner && winner.username ? winner.username : '(unknown)');
                    try { console.log(this.print_unicode_board()); } catch (e) { console.log('Failed printing board', e); }
                    this._game_over = true;
                    try {
                        // Determine winner color (opposite of colorToMove) and read username from DOM
                        const winnerColor = (colorToMove == PieceColor.WHITE) ? 'black' : 'white';
                        let winnerName = 'Winner';
                        try {
                            const nameEl = document.getElementById(winnerColor + '-player-username');
                            const idEl = document.getElementById(winnerColor + '-player-id');
                            if (nameEl && nameEl.value) winnerName = nameEl.value;
                            else if (idEl && idEl.value) winnerName = idEl.value;
                        } catch (e) {
                            // fallback to piece-based winner object if available
                            if (winner && winner.username) winnerName = winner.username;
                            else if (winner && winner.id) winnerName = String(winner.id);
                        }
                        const msg = `Checkmate. ${winnerName} wins.`;
                        if (typeof window !== 'undefined' && window.writeConsole) {
                            try { window.writeConsole(msg); } catch(e) { console.log('writeConsole failed', e); }
                        } else {
                            console.log(msg);
                        }
                    } catch (e) {}
                    try {
                        if (typeof window !== 'undefined' && window.GAME_ID) {
                            fetch(window.DECLARE_WIN_URL || '/declare_win/', {
                                method: 'POST',
                                credentials: 'same-origin',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'X-CSRFToken': _getCsrfTokenFromCookie()
                                },
                                body: JSON.stringify({ game_id: window.GAME_ID, winner_id: winner && winner.id ? winner.id : null })
                            }).then(r => r.json()).then(d => {
                                console.log('declare_win response:', d);
                                try {
                                    if (d && d.winner_username) {
                                        const msg = `Checkmate. ${d.winner_username} wins.`;
                                        if (typeof window !== 'undefined' && window.writeConsole) {
                                            try { window.writeConsole(msg); } catch(e) { console.log('writeConsole failed', e); }
                                        } else { console.log(msg); }
                                    }
                                } catch (e) { console.error('processing declare_win response failed', e); }
                            }).catch(e => console.error('declare_win failed', e));
                        }
                    } catch (e) { console.error('Error declaring win:', e); }
                }
                else if (!inCheck && !hasMoves) {
                    // Stalemate (no legal moves and not in check)
                    console.log('GAME OVER: Stalemate (draw)');
                    try { console.log(this.print_unicode_board()); } catch (e) { console.log('Failed printing board', e); }
                    this._game_over = true;
                    try {
                        // Compute canonical draw reason key for server and a human
                        // readable message for local console.
                        let reasonKey = null;
                        let humanReason = 'draw';
                        try {
                            if (this.stalemate_by_threefold_repetition && this.stalemate_by_threefold_repetition()) {
                                reasonKey = 'threefold';
                                humanReason = 'threefold repetition';
                            } else if (this.stalemate_by_50_move_rule && this.stalemate_by_50_move_rule()) {
                                reasonKey = '50-move';
                                humanReason = '50-move rule';
                            } else {
                                reasonKey = 'no-legal-moves';
                                humanReason = `no legal moves for ${colorToMove == PieceColor.WHITE ? 'white' : 'black'}`;
                            }
                        } catch (e) {
                            reasonKey = null;
                            humanReason = 'draw';
                        }
                        const msg = `Stalemate by ${humanReason}.`;
                        if (typeof window !== 'undefined' && window.writeConsole) {
                            try { window.writeConsole(msg); } catch(e) { console.log('writeConsole failed', e); }
                        } else {
                            console.log(msg);
                        }
                    } catch (e) {}
                    try {
                        if (typeof window !== 'undefined' && window.GAME_ID) {
                            fetch(window.DECLARE_DRAW_URL || '/declare_draw/', {
                                method: 'POST',
                                credentials: 'same-origin',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'X-CSRFToken': _getCsrfTokenFromCookie()
                                },
                                body: JSON.stringify({ game_id: window.GAME_ID, reason: reasonKey })
                            }).then(r => r.json()).then(d => {
                                console.log('declare_draw response:', d);
                                try {
                                    if (d && d.ok) {
                                        const msg = 'Stalemate declared (draw).';
                                        if (typeof window !== 'undefined' && window.writeConsole) {
                                            try { window.writeConsole(msg); } catch(e) { console.log('writeConsole failed', e); }
                                        } else { console.log(msg); }
                                    }
                                } catch (e) { console.error('processing declare_draw response failed', e); }
                            }).catch(e => console.error('declare_draw failed', e));
                        }
                    } catch (e) { console.error('Error declaring draw:', e); }
                }
            } catch (e) {
                console.error('endgame detection error', e);
            }
    }
    stalemate_by_threefold_repetition() {
        // Method to check for stalemate by threefold repetition
        let stateCount = {};
        for (let state of this.board_history) {
            if (stateCount[state]) {
                stateCount[state] += 1;
            }
            else {
                stateCount[state] = 1;
            }
            if (stateCount[state] >= 3) {
                return true;
            }
        }
        return false;
    }
    stalemate(){
        // Method to check for any stalemate condition
        return this.stalemate_by_no_moves() ||
               this.stalemate_by_50_move_rule() ||
               this.stalemate_by_threefold_repetition();
    }
    toString() {
        // Each cell shows only the 2-char piece string; borders use +--+ segments.
        const borderLine = () => '+' + Array.from({length:8}).map(()=> '--').join('+') + '+';

        const cols = Array.from({length:8}).map((_,i) => ` ${String.fromCharCode(65 + i)}`).join(' ');

        let lines = [];
        lines.push('     ' + cols);
        lines.push('   ' + borderLine());

        for (let rank = 8, r = 7; rank >= 1; rank--, r--) {
            let rowCells = '';
            for (let c = 0; c < 8; c++) {
                // piece string exactly two chars (pad or trim)
                let cellStr = String(this.squares[r][c]);
                if (cellStr.length < 2) { cellStr = cellStr.padEnd(2, ' '); }
                else if (cellStr.length > 2) { cellStr = cellStr.slice(0,2); }
                rowCells += `|${cellStr}`;
            }
            rowCells += '|';
            lines.push(`${String(rank).padStart(2,' ')} ${rowCells} ${rank}`);
            lines.push('   ' + borderLine());
        }

        lines.push('     ' + cols);
        return lines.join('\n');
    }
    move_to_string(fromSquare, toSquare, promotionType = null) {
        //Takes the fromSquare, toSquare, and promotionType (if any) and returns a short string representation of the move
        if (promotionType == null) {
            return `${fromSquare.print_loc()}${toSquare.print_loc()}`;
        }
        else {
            let promoChar = '';
            switch (promotionType) {
                case PieceType.QUEEN:
                    promoChar = 'Q';
                    break;
                case PieceType.ROOK:
                    promoChar = 'R';
                    break;
                case PieceType.BISHOP:
                    promoChar = 'B';
                    break;
                case PieceType.KNIGHT:
                    promoChar = 'N';
                    break;
                default:
                    throw new Error("Invalid piece type for promotion");
            }
            return `${fromSquare.print_loc()}${toSquare.print_loc()}${promoChar}`;
        }
    }
    serialize_board() {
        // Simple deterministic serialization of board state for repetition checks.
        // Format: rows joined by '/', each cell two chars: '.' for empty or e.g. 'wK' for white king, 'bQ' for black queen.
        const typeChar = (t) => {
            switch (t) {
                case PieceType.PAWN: return 'P';
                case PieceType.ROOK: return 'R';
                case PieceType.KNIGHT: return 'N';
                case PieceType.BISHOP: return 'B';
                case PieceType.QUEEN: return 'Q';
                case PieceType.KING: return 'K';
                default: return '?';
            }
        };
        let rows = [];
        for (let r = 0; r < 8; r++) {
            let cols = [];
            for (let c = 0; c < 8; c++) {
                let p = this.squares[r][c].piece;
                if (!p || p.type == PieceType.EMPTY) {
                    cols.push('..');
                } else {
                    let colorChar = (p.color == PieceColor.WHITE) ? 'w' : 'b';
                    cols.push(colorChar + typeChar(p.type));
                }
            }
            rows.push(cols.join(''));
        }
        return rows.join('/');
    }
    string_to_move(moveStr) {
        //Takes a move string and returns the corresponding fromSquare, toSquare, and promotionType (if any)
        if (moveStr.length < 4 || moveStr.length > 5) {
            throw new Error("Invalid move string length");
        }
        let fromCol = moveStr.charCodeAt(0) - 65;
        let fromRow = parseInt(moveStr.charAt(1)) - 1;
        let toCol = moveStr.charCodeAt(2) - 65;
        let toRow = parseInt(moveStr.charAt(3)) - 1;
        let promotionType = null;
        if (moveStr.length == 5) {
            let promoChar = moveStr.charAt(4);
            switch (promoChar) {
                case 'Q':
                    promotionType = PieceType.QUEEN;
                    break;
                case 'R':
                    promotionType = PieceType.ROOK;
                    break;
                case 'B':
                    promotionType = PieceType.BISHOP;
                    break;
                case 'N':
                    promotionType = PieceType.KNIGHT;
                    break;
                default:
                    throw new Error("Invalid promotion character in move string");
            }
        }
        let fromSquare = this.squares[fromRow][fromCol];
        let toSquare = this.squares[toRow][toCol];
        return {fromSquare, toSquare, promotionType};
    }
    user_active() {
        // Method to see if the user is the active player
        if (this.user == null) {
            throw new Error("User player not set");
        }
        return this.active_player == this.user;
    }
    execute_other_move(movestr){
        // Method to execute a move given its string representation for the non-user player
        let {fromSquare, toSquare, promotionType} = this.string_to_move(movestr);
            try {
            const fromId = fromSquare.get_html_id ? fromSquare.get_html_id() : `${fromSquare.row},${fromSquare.col}`;
            const toId = toSquare.get_html_id ? toSquare.get_html_id() : `${toSquare.row},${toSquare.col}`;
            const fromType = fromSquare.piece ? fromSquare.piece.type : 'NO_PIECE_OBJ';
            console.log('execute_other_move: move=', movestr, 'from=', fromId, 'to=', toId, 'fromType=', fromType, 'promotion=', promotionType);
            // If the source square is already empty the move was likely already applied locally
            if (fromSquare.piece && fromSquare.piece.type == PieceType.EMPTY) {
                console.log('execute_other_move: skipping already-applied move (from square empty)', movestr, 'from=', fromId);
                return;
            }
            // Defensive: ensure fromSquare has a piece
            if (!fromSquare.piece) {
                console.warn('execute_other_move: fromSquare has no piece object, skipping move', movestr, 'from=', fromId);
                return;
            }
            this.actually_make_move(fromSquare, toSquare, promotionType);
            console.log('execute_other_move: applied move', movestr, 'now serial=', this.serialize_board());
            this.see_board();
        } catch (e) {
            console.error('execute_other_move: error applying move', movestr, e);
            throw e;
        }
    }
    user_make_move(fromSquare, toSquare, promotionType = null) {
        // Method for the user to make a move and returns the move string
        if (this.user_active()) {
            if (this.checkmate_status()) {
                throw new Error("Cannot make a move: checkmate has occurred");
            }
            else if (this.stalemate()) {
                throw new Error("Cannot make a move: stalemate has occurred");
            }
            this.actually_make_move(fromSquare, toSquare, promotionType);
            return this.move_to_string(fromSquare, toSquare, promotionType);
        }
        else {
            throw new Error("It's not the user's turn to move");
        }
    }
    print_unicode_board() {
        // Nicely aligned Unicode board: columns A..H and ranks 8..1
        const cols = Array.from({ length: 8 }).map((_, i) => String.fromCharCode(65 + i));
        let lines = [];
        // Header
        lines.push('    ' + cols.map(c => ` ${c} `).join(''));
        // Rows from 8 down to 1
        for (let r = 7; r >= 0; r--) {
            const rank = r + 1;
            let rowCells = [];
            for (let c = 0; c < 8; c++) {
                const p = this.squares[r][c].piece;
                const ch = (p && p.unicodeChar && p.unicodeChar()) ? p.unicodeChar() : '.';
                // pad with spaces so each cell is width 3 (space + symbol + space)
                rowCells.push(` ${ch} `);
            }
            lines.push(`${String(rank).padStart(2,' ')}  ${rowCells.join('') } ${rank}`);
        }
        // Footer
        lines.push('    ' + cols.map(c => ` ${c} `).join(''));
        return lines.join('\n');
    }

    // Render the board into the DOM. `containerSelector` should point to the element
    // with class `board` (or similar). This function will construct the 10x10 grid
    // tracks (edges + 8x8 squares) if the container is empty, and populate each
    // chess square element's text with the piece Unicode character via `unicodeChar()`.
    // Mapping: grid top row corresponds to board rank 8.
    renderBoardToDOM(containerSelector) {
        const container = document.querySelector(containerSelector);
        if (!container) { throw new Error('Board container not found: ' + containerSelector); }

        // Helper to create a div with optional classes and id
        const mk = (cls, id) => {
            const d = document.createElement('div');
            if (cls) d.className = cls;
            if (id) d.id = id;
            return d;
        };

        // If container is empty, build the full grid: 10x10 (edges + 8 squares)
        if (!container.hasChildNodes()) {
            for (let gr = 0; gr < 10; gr++) {
                for (let gc = 0; gc < 10; gc++) {
                    // corners
                    if ((gr == 0 || gr == 9) && (gc == 0 || gc == 9)) {
                        container.appendChild(mk('corner'));
                    }
                    // top/bottom horizontal edges (excluding corners)
                    else if (gr == 0 || gr == 9) {
                        // gc in 1..8 -> horizontal edge
                        container.appendChild(mk('horizontal-white-edge'));
                    }
                    // left/right vertical edges
                    else if (gc == 0 || gc == 9) {
                        container.appendChild(mk('vertical-white-edge'));
                    }
                    else {
                        // calculate board indices: gr=1 -> top rank 8 -> boardRow = 7
                        let boardRow = 8 - gr;
                        let boardCol = gc - 1;
                        const square = this.squares[boardRow][boardCol];
                        const cls = ((boardRow + boardCol) % 2 == 0) ? 'white-square' : 'black-square';
                        const id = square.get_html_id();
                        const el = mk(cls + ' square', id);
                        el.style.display = 'flex';
                        el.style.alignItems = 'center';
                        el.style.justifyContent = 'center';
                        el.style.fontSize = 'calc(var(--square-size) * 0.8)';
                        container.appendChild(el);
                    }
                }
            }
        }
        // Now populate each chess square by id (a1..h8)
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const sq = this.squares[r][c];
                const id = sq.get_html_id();
                const el = document.getElementById(id);
                if (el) {
                    el.textContent = sq.piece ? sq.piece.unicodeChar() : '';
                }
            }
        }
    }
    define_html_ids() {
        // Define HTML IDs for all squares on the board
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                this.squares[r][c].define_html_id();
            }
        }
    }
    html_id_to_square(id) {
        // Convert an HTML ID back to the corresponding Square object
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                if (this.squares[r][c].get_html_id() == id) {
                    return this.squares[r][c];
                }
            }
        }
        throw new Error("No square found for HTML ID: " + id);
    }
    listen_for_square_clicks(containerSelector) {
        // Set up click listeners on all squares within the specified container.
        // Returns the clicked Square object.
        const container = document.querySelector(containerSelector);
        if (!container) { throw new Error('Board container not found: ' + containerSelector); }
        // Return a Promise that resolves with the clicked Square. The caller
        // can `await` this to pause until a click occurs.
        return new Promise((resolve) => {
            const handler = (event) => {
                const target = event.target;
                // The board squares in the HTML are buttons with classes
                // `white-square` or `black-square` — accept either.
                if (target.classList && (target.classList.contains('white-square') || target.classList.contains('black-square'))) {
                    try {
                        const square = this.html_id_to_square(target.id);
                        container.removeEventListener('click', handler);
                        resolve(square);
                    } catch (e) {
                        // ignore clicks that aren't on valid squares
                    }
                }
            };
            container.addEventListener('click', handler);
        });
    }
    async move_handling(){
        //Stores the squares for the sake of a move
        console.log('move_handling invoked: user=', this.user, 'active_player=', this.active_player);
        if (this._game_over) {
            console.log('move_handling: game is over, not accepting moves');
            return;
        }
        if (this._move_handling_running) {
            console.log('move_handling: already running, skipping re-entry');
            return;
        }
        this._move_handling_running = true;
        try {
            if (this.user_active() == true){
                this.see_board();
                let toSquare = null;
                let fromSquare = null;
                for (let i = 0; i < 8; i++) {
                    for (let j = 0; j < 8; j++) {
                        this.squares[i][j].piece.get_moveable_squares();
                    }
                }
                while (true){
                    let clickedSquare = await this.listen_for_square_clicks('.board');
                    if (fromSquare == null){
                        if (clickedSquare.piece.color == this.active_player.get_color() && clickedSquare.piece.locations.length > 0){
                            fromSquare = clickedSquare;
                        }
                    }
                    else if (toSquare == null){
                        if (clickedSquare == fromSquare){
                            fromSquare = null;
                        }
                        else if (fromSquare.piece.locations.includes(clickedSquare)){
                            toSquare = clickedSquare;
                        }
                        else {
                            toSquare = null;
                            fromSquare = null;
                        }
                    }
                    else {
                        fromSquare = null;
                        toSquare = null;
                    }
                    if (fromSquare != null && toSquare != null){
                        // Determine if this move is a pawn promotion.
                        let promotionType = null;
                        if (fromSquare.piece.type == PieceType.PAWN) {
                            if ((fromSquare.piece.color == PieceColor.WHITE && toSquare.row == 7) || (fromSquare.piece.color == PieceColor.BLACK && toSquare.row == 0)) {
                                // Ask the UI to choose a promotion type if available, default to QUEEN
                                if (typeof window !== 'undefined' && window.askPromotion) {
                                    try {
                                        const chosen = await window.askPromotion();
                                        promotionType = (typeof chosen === 'number') ? chosen : PieceType.QUEEN;
                                    } catch (e) {
                                        promotionType = PieceType.QUEEN;
                                    }
                                } else {
                                    promotionType = PieceType.QUEEN;
                                }
                            }
                        }
                        this.actually_make_move(fromSquare, toSquare, promotionType);
                        this.see_board();
                        return;
                    }
                }
            }
        } catch (e) {
            console.error('move_handling caught exception:', e, e.stack);
            throw e;
        } finally {
            this._move_handling_running = false;
        }
    }
}