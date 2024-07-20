import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import pg from "pg";
import dotenv from "dotenv";

const app = express();
const port = 3000;
const API_URL = "https://covers.openlibrary.org/b";
dotenv.config();

const { Pool } = pg;
const connectionString = process.env.DATABASE_URL;

const db = new Pool({
  connectionString: connectionString,
  ssl: {
    rejectUnauthorized: false, // This line may be necessary for some environments
  },
});

db.connect();

const key = "isbn";
const size = "L"; // Set size to "L" for large thumbnails

app.use(express.static("public"));

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

async function isValidImageUrl(url) {
  try {
    const response = await axios.head(url);
    return response.headers["content-type"].startsWith("image");
  } catch (error) {
    return false;
  }
}

app.get("/", async (req, res) => {
  try {
    const sortOption = req.query.sort;
    let books = [];

    if (sortOption === "rating") {
      const bookInfo = await db.query("SELECT * FROM books ORDER BY rating DESC");
      books = bookInfo.rows;
    } else if (sortOption === "newly_added") {
      const bookInfo = await db.query("SELECT * FROM books ORDER BY date DESC");
      books = bookInfo.rows;
    }
     else if (sortOption === "name") {
      const bookInfo = await db.query("SELECT * FROM books");
      books = bookInfo.rows;
      books.sort((a, b) => a.title.localeCompare(b.title));
    } else {
      const bookInfo = await db.query("SELECT * FROM books");
      books = bookInfo.rows;
    }

    res.render("index.ejs", { books, sortOption });

  } catch (error) {
    console.error('Error fetching books:', error);
    res.status(500).send('Error fetching books');
  }
});

app.get("/home", (req, res) => {
  res.redirect("/");
});

app.get("/about", (req, res) => {
  res.render("about.ejs");
});

app.get("/contact", (req, res) => {
  res.render("contact.ejs");
});

app.get("/submit-contact", (req, res) => {
  res.render("response.ejs");
});

app.post("/submit-contact", (req, res) => {
  const { name, email, message } = req.body;
  res.render("response.ejs", { name });
});

app.get("/isbn", (req, res) => {
  res.render("isbn.ejs");
});

app.post("/isbn", async (req, res) => {
  const fetchBookISBN = async (title) => {
    try {
      const response = await fetch(`https://openlibrary.org/search.json?title=${encodeURIComponent(title)}`);
      const data = await response.json();
      const isbn = data.docs[0]?.isbn?.[0] || 'not available';
      return isbn;
    } catch (error) {
      console.error('Error:', error);
      throw error; // Throw error to be caught by .catch() if needed
    }
  };

  const title = req.body.title;
  console.log(title);
  try {
    const isbn = await fetchBookISBN(title);
    console.log(`ISBN for "${title}": ${isbn}`);
    res.render("value.ejs", { message: { title: title, isbn: isbn } });
    await db.query("DELETE FROM isbn");
    await db.query("INSERT INTO isbn (book_name, book_isbn) VALUES ($1, $2)", [title, isbn]);


  } catch (error) {
    console.error('Error:', error);
    res.status(500).send('Error fetching ISBN'); // Handle error response
  }
});

app.get("/new", async (req, res) => {
  try {
    const bookInfo = await db.query("SELECT * FROM books");
    const books = bookInfo.rows;
    res.render("new.ejs", { books });
  } catch (error) {
    console.error('Error inserting new book:', error);
    // Handle the error appropriately (e.g., send an error response)
    // res.status(500).send('Error inserting new book');
  }
});

app.get("/isbn_new", async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM isbn ORDER BY id DESC LIMIT 1");
    const lastAddedRow = result.rows[0];

    const add = lastAddedRow.book_isbn;
    console.log(add);

    res.render("isbn_new.ejs", { add: add });
  } catch (error) {
    console.error('Error inserting new book:', error);
    // Handle the error appropriately (e.g., send an error response)
    // res.status(500).send('Error inserting new book');
  }
});

app.get("/edit", async (req, res) => {
  const isbn = req.query.isbn; // Get the isbn from query parameters
  try {
    const result = await db.query("SELECT * FROM books WHERE isbn = $1", [isbn]);
    if (result.rows.length > 0) {
      // Assuming there's only one result expected
      const post = result.rows[0]; // Access the first element
      res.render("edit.ejs", { post });
    } else {
      res.status(404).send("Book not found");
    }
  } catch (err) {
    console.error("Error fetching book:", err);
    res.status(500).send("Error fetching book");
  }
});

app.post("/new", async (req, res) => {
  try {
    const { title, description, author, isbn, rating, } = req.body;
    let date = new Date().toISOString(); // Outputs: 2024-07-05T12:34:56.789Z
    console.log(date);


    if (rating > 10) {
      return res.status(400).send("Value of rating cannot exceed 10");
    }
    else if (isNaN(rating)) {
      return res.status(400).send("Value of rating must be a number between 1 to 10");
    }


    // Construct the thumbnail URL
    const thumbnailUrl = `${API_URL}/${key}/${isbn}-${size}.jpg`;

    // Check if the thumbnail URL is valid
    const isValid = await isValidImageUrl(thumbnailUrl);

    if (!isValid) {
      // Handle case where thumbnail URL is invalid
      return res.status(400).send("Invalid ISBN");
    }

    // Check if the book with the given ISBN already exists in the database
    const existingBook = await db.query("SELECT * FROM books WHERE isbn = $1", [isbn]);
    if (existingBook.rows.length > 0) {
      console.log(`Book with ISBN ${isbn} already exists.`);
      return res.status(400).send("Book already added");
    }

    // Insert the new book into the database
    const newBookInsert = `
            INSERT INTO books(title, description, author, rating, isbn, thumbnail, date)
            VALUES($1, $2, $3, $4, $5, $6, $7)
            RETURNING *
        `;
    const newBookValues = [title, description, author, rating, isbn, thumbnailUrl, date];
    const insertedBook = await db.query(newBookInsert, newBookValues);

    console.log(`Book with ISBN ${isbn} added successfully.`);

    // Redirect back to the homepage or perform additional actions
    res.redirect("/");
  } catch (error) {
    console.error('Error adding new book:', error);
    res.status(500).send('Error adding new book');
  }
});

app.post("/edit", async (req, res) => {
  const { title, description, author, rating } = req.body;
  const isbn = req.query.isbn;

  if (rating > 10) {
    return res.status(400).send("Value of rating cannot exceed 10");
  }
  else if (isNaN(rating)) {
    return res.status(400).send("Value of rating must be a number between 1 to 10");
  }

  const result = await db.query("SELECT * FROM books WHERE isbn = $1", [isbn]);
  if (result.rows.length > 0) {
    await db.query("UPDATE books SET title = $1, description = $2, author = $3, rating = $4 WHERE isbn = $5;", [title, description, author, rating, isbn]);
    res.redirect("/");
  } else {
    res.status(404).send("Book not found");
  }

});

app.post("/delete", async (req, res) => {
  const { title, description, author, rating, isbn } = req.body;

  try {
    const result = await db.query("SELECT * FROM books WHERE isbn = $1", [isbn]);

    if (result.rows.length > 0) {
      await db.query("DELETE FROM books WHERE isbn = $1", [isbn]);
      res.redirect("/");
    } else {
      res.status(404).send("Cannot delete - Book not found");
    }
  } catch (error) {
    console.error('Error deleting book:', error);
    res.status(500).send("Error deleting book");
  }
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
