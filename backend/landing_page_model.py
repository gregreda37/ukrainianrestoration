from flask import request, jsonify, Blueprint
import os
import openai
from dotenv import load_dotenv
import time
import pdfplumber
import pandas as pd
import re
import tiktoken
from firebase_admin import firestore

load_dotenv()

db = firestore.client()
# Set up Azure OpenAI credentials
openai.api_type = "azure"
openai.api_base = os.getenv("AZURE_OPENAI_ENDPOINT")  # Example: https://<your-resource-name>.openai.azure.com/
openai.api_version = os.getenv("AZURE_OPENAI_API_VERSION")  # Example: 2023-07-01-preview
openai.api_key = os.getenv("AZURE_OPENAI_API_KEY")

UPLOAD_FOLDER = "uploads"
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

def extract_text_from_pdf(file_path):
    """
    Extracts text from a PDF file.
    """
    text = ""
    try:
        with pdfplumber.open(file_path) as pdf:
            for page in pdf.pages:
                text += page.extract_text()
    except Exception as e:
        print(f"Error extracting text from PDF: {e}")
    return text

def extract_table_from_pdf(file_path):
    """
    Extracts table data from a PDF file and converts it to a DataFrame.
    Handles cases where rows have a different number of columns than the header
    and ensures column names are unique.
    """
    try:
        with pdfplumber.open(file_path) as pdf:
            tables = []
            for page in pdf.pages:
                table = page.extract_table()
                if table:
                    tables.extend(table)  # Combine all tables into one list

            # Convert the table data to a DataFrame
            if tables:
                header = tables[0]  # Use the first row as column headers
                rows = tables[1:]  # Remaining rows are the data

                # Ensure all rows have the same number of columns as the header
                normalized_rows = [row[:len(header)] + [None] * (len(header) - len(row)) for row in rows]

                # Create the DataFrame
                df = pd.DataFrame(normalized_rows, columns=header)

                # Ensure column names are unique
                df.columns = pd.io.parsers.ParserBase({'names': df.columns})._maybe_dedup_names(df.columns)

                return df
    except Exception as e:
        print(f"Error extracting table from PDF: {e}")
    return None

def split_into_chunks(text, chunk_size=1000):
    """
    Splits text into chunks of a specified size.
    """
    lines = text.splitlines()
    chunks = []
    current_chunk = []

    for line in lines:
        if sum(len(l) for l in current_chunk) + len(line) > chunk_size:
            chunks.append("\n".join(current_chunk))
            current_chunk = []
        current_chunk.append(line)

    if current_chunk:
        chunks.append("\n".join(current_chunk))

    return chunks

def extract_structured_data(invoice_text):
    """
    Extracts structured data from the invoice text using regex.
    This is a placeholder implementation and should be customized
    based on the actual invoice format and required fields.
    """
    structured_data = {}
    try:
        # Example: Extract invoice number, date, and total amount
        invoice_number = re.search(r"Invoice Number:\s*(\S+)", invoice_text)
        invoice_date = re.search(r"Invoice Date:\s*([\d\-]+)", invoice_text)
        total_amount = re.search(r"Total Amount:\s*\$?([\d,]+\.\d{2})", invoice_text)

        if invoice_number:
            structured_data["invoice_number"] = invoice_number.group(1)
        if invoice_date:
            structured_data["invoice_date"] = invoice_date.group(1)
        if total_amount:
            structured_data["total_amount"] = total_amount.group(1)

        # Add more fields as needed
    except Exception as e:
        print(f"Error extracting structured data: {e}")

    return structured_data

# Create a blueprint for this model
landing_page_app = Blueprint("landing_page", __name__)

@landing_page_app.route('/process-document', methods=['POST'])
def process_document():
    try:
        # Get form data
        project = request.form.get("project")
        user_id = request.form.get("userID")  # Get userID from the request
        organization_name = request.form.get("organizationName")  # Get organizationName from the request

        # Validate userID and organizationName
        if not user_id or not organization_name:
            return jsonify({"error": "userID and organizationName are required"}), 400

        # Save uploaded file
        invoice = request.files.get("document")
        invoice_path = None

        if invoice:
            invoice_path = os.path.join(UPLOAD_FOLDER, invoice.filename)
            invoice.save(invoice_path)

        # Extract text and table data from the PDF
        invoice_text = extract_text_from_pdf(invoice_path) if invoice_path else ""
        invoice_table = extract_table_from_pdf(invoice_path)

        # Convert the table to JSON if it exists
        table_json = None
        if invoice_table is not None:
            table_json = invoice_table.to_json(orient="records")  # Convert DataFrame to JSON

        # Extract structured data from the text
        extracted_data = extract_structured_data(invoice_text)

        # Split text into smaller chunks
        invoice_chunks = split_into_chunks(invoice_text, chunk_size=1000)
        #   {"role": "system", "content": 
        #      "You are a helpful assistant. The uploaded document is an invoice submitted as revisions from an invoice we've submitted "
        #      "to an insurance company. Focus on analyzing key details such as totals, descriptions, and amounts. Highlight any differences "
        #      "or requested changes and provide recommendations for supplemental information (e.g., photos, documents, evidence)."
        #      "Format all responses in markdown for better readability."
        #     },
        # Prepare messages for the LLM
        messages = [
            {"role": "system", "content": 
             "You are a highly intelligent and helpful assistant. The user will provide various company-specific documents, such as insurance policies, internal reports, invoices, and other business-related files. Your task is to analyze these documents, extract key insights, summarize the most important information, and prepare structured data for storage in the database. Ensure the summaries are concise, accurate, and formatted for easy retrieval in the future."
            },
            {"role": "user", "content": f"Project details: {project}"},
        ]

        # Add table data to the messages if available
        if table_json:
            messages.append({"role": "user", "content": f"Invoice table data: {table_json}"})

        # Add chunks of the invoice text to the messages
        for i, chunk in enumerate(invoice_chunks):
            messages.append({"role": "user", "content": f"Invoice content (Part {i+1}): {chunk}"})

        # Retry logic for rate-limiting errors
        max_retries = 3
        retry_delay = 10  # Wait 10 seconds before retrying
        for attempt in range(max_retries):
            try:
                # Call the Azure OpenAI API
                response = openai.ChatCompletion.create(
                    deployment_id=os.getenv("AZURE_OPENAI_DEPLOYMENT_NAME"),  # Use 'deployment_id' for Azure
                    messages=messages,
                    max_tokens=3000,  # Request a long response
                    temperature=0.7
                )
                # Log token usage
                if "usage" in response:
                    print(f"Prompt tokens used: {response['usage']['prompt_tokens']}")
                    print(f"Completion tokens used: {response['usage']['completion_tokens']}")
                    print(f"Total tokens used: {response['usage']['total_tokens']}")

                # Format the response in Markdown
                bot_response = response['choices'][0]['message']['content'].strip()

                # Store the document in Firestore under the `submitted_documents` subcollection
                doc_ref = db.collection("organization_data").document(organization_name).collection(project).document()
                doc_ref.set({
                    "project": project,
                    "organizationName": organization_name,
                    "document_text": invoice_text,
                    "table_data": table_json,
                    "response": bot_response,
                    "timestamp": time.time(),
                    "filename": invoice.filename if invoice else None
                })

                # Store extracted structured data in Firestore
                structured_data_ref = db.collection("organization_data").document(organization_name).collection(project).document("structured_data")
                structured_data_ref.set(extracted_data, merge=True)

                return jsonify({"response": bot_response, "extracted_data": extracted_data})
            except openai.OpenAIError as e:  # Catch all OpenAI-related errors
                if "Rate limit exceeded" in str(e) and attempt < max_retries - 1:
                    print(f"Rate limit exceeded. Retrying in {retry_delay} seconds...")
                    time.sleep(retry_delay)
                else:
                    print(f"OpenAI API error: {e}")
                    return jsonify({"error": "An error occurred while processing your request."}), 500
    except Exception as e:
        # Log the error for debugging
        print(f"Error processing document: {e}")
        return jsonify({"error": str(e)}), 500

@landing_page_app.route('/retrieve-questions', methods=['GET'])
def retrieve_questions():
    try:
        user_id = request.args.get("userID")  # Get userID from query parameters
        organization_name = request.args.get("organizationName")  # Get organizationName from query parameters
        project = request.args.get("project")  # Get project from query parameters

        print(f"Retrieving questions for userID: {user_id}, organizationName: {organization_name}, project: {project}")
        # Validate userID, organizationName, and project
        if not user_id or not organization_name or not project:
            return jsonify({"error": "userID, organizationName, and project are required"}), 400

        # Retrieve all questions and responses for the given userID, organizationName, and project
        questions = []
        docs = db.collection("organization_data").document(organization_name).collection(project).collection("questions").stream()
        for doc in docs:
            questions.append(doc.to_dict())
        return jsonify({"questions": questions})
    except Exception as e:
        print(f"Error retrieving questions: {e}")
        return jsonify({"error": str(e)}), 500

@landing_page_app.route('/ask-chatbot', methods=['POST'])
def ask_chatbot():
    try:
        # Get form data
        user_id = request.json.get("userID")
        project = request.json.get("project")
        organization_name = request.json.get("organizationName")
        question = request.json.get("question")

        # Debugging: Log the incoming request data
        print(f"Received userID: {user_id}, project: {project}, organizationName: {organization_name}, question: {question}")

        # Validate userID, project, organizationName, and question
        if not user_id or not project or not organization_name or not question:
            return jsonify({"error": "userID, project, organizationName, and question are required"}), 400

        # Check if the project exists in Firestore
        project_ref = db.collection("organization_data").document(organization_name).collection(project)
        docs = project_ref.stream()
        project_exists = any(True for _ in docs)

        # If the project does not exist, create an initial entry
        if not project_exists:
            print(f"Project '{project}' does not exist. Creating a new project.")
            project_ref.document().set({
                "document_text": "",
                "table_data": "",
                "timestamp": time.time(),
                "organizationName": organization_name,
                "note": "Initial project entry created."
            })

        # Parse the question to check if it contains a "store" intent
        if "save" in question.lower() or "store" in question.lower():
            match = re.search(r"save (.+?) as (.+)", question, re.IGNORECASE)
            if match:
                key = match.group(1).strip()
                value = match.group(2).strip()

                # Ensure sensitive data is handled securely
                if key.lower() in ["phone number", "email"]:
                    print("Sensitive data detected. Storing securely.")
                    data_ref = db.collection("organization_data").document(organization_name).collection(project).document("sensitive_data")
                    data_ref.set({key: value}, merge=True)
                    return jsonify({"response": f"Stored '{key}' securely in the database."})

        # Retrieve all documents and related questions for the selected project
        docs = project_ref.order_by("timestamp", direction=firestore.Query.DESCENDING).stream()
        context = ""
        for doc in docs:
            doc_data = doc.to_dict()
            context += doc_data.get("document_text", "") + "\n" + (doc_data.get("table_data", "") or "")
            if "question" in doc_data and "response" in doc_data:
                context += f"\nQ: {doc_data['question']}\nA: {doc_data['response']}"

        # Retrieve stored data and include it in the context
        stored_data_ref = db.collection("organization_data").document(organization_name).collection(project).document("stored_data")
        stored_data_doc = stored_data_ref.get()
        if stored_data_doc.exists:
            stored_data = stored_data_doc.to_dict()
            context += "\nStored Data:\n" + "\n".join([f"{k}: {v}" for k, v in stored_data.items()])

        if not context:
            return jsonify({"error": f"No document or related questions found for the project '{project}'."}), 404

        # Use OpenAI to answer the question
        messages = [
            {"role": "system", "content": "You are a helpful assistant. Use the provided context to answer the user's question."},
            {"role": "user", "content": f"Context: {context}\n\nQuestion: {question}"}
        ]
        response = openai.ChatCompletion.create(
            deployment_id=os.getenv("AZURE_OPENAI_DEPLOYMENT_NAME"),
            messages=messages,
            max_tokens=500,
            temperature=0.7
        )

        # Extract the response
        bot_response = response['choices'][0]['message']['content'].strip()

        # Store the question and response in Firestore under the `questions` subcollection
        question_ref = db.collection("organization_data").document(organization_name).collection(project).document()
        question_ref.set({
            "project": project,
            "organizationName": organization_name,
            "question": question,
            "response": bot_response,
            "timestamp": time.time()
        })

        return jsonify({"response": bot_response})
    except Exception as e:
        print(f"Error answering chatbot question: {e}")
        return jsonify({"error": str(e)}), 500
    
if __name__ == '__main__':
    print(f"Using Azure OpenAI deployment: {os.getenv('AZURE_OPENAI_DEPLOYMENT_NAME')}")
    print(f"API Key: {os.getenv('AZURE_OPENAI_API_KEY')}")
    print(f"API Endpoint: {os.getenv('AZURE_OPENAI_ENDPOINT')}")
    print(f"Deployment Name: {os.getenv('AZURE_OPENAI_DEPLOYMENT_NAME')}")
    print(f"API Version: {os.getenv('AZURE_OPENAI_API_VERSION')}")
    print(app.url_map) 
    app.run(debug=True)