import requests
import json
import os
import time
import argparse
import sys

# --- Configuration ---
API_BASE_URL = "https://api.discogs.com"
USER_AGENT = "Rekkids/1.0 +https://your-rekkids-instance.url" # Customize if possible
REQUEST_DELAY = 1.2
TOKEN_ENV_VAR = "DISCOGS_API_TOKEN"

# --- Helper Functions ---

def get_collection(username, token):
    """Fetches the user's main collection (folder 0) from Discogs using token authentication."""
    if not token:
         print("\n*** INTERNAL ERROR: get_collection called without a token. ***")
         return None

    print(f"Fetching collection for user: {username}...")
    collection_url = f"{API_BASE_URL}/users/{username}/collection/folders/0/releases"
    headers = {
        "User-Agent": USER_AGENT,
        "Authorization": f"Discogs token={token}"
    }

    all_releases = []
    page = 1
    current_url = collection_url

    while current_url:
        try:
            print(f"Fetching page {page} from {current_url}...")
            response = requests.get(current_url, headers=headers, params={'per_page': 100}, timeout=30)

            if response.status_code == 401:
                print("\n*** ERROR: Authentication failed (401 Unauthorized). ***")
                print(f"*** Check if the token provided (from ENV var '{TOKEN_ENV_VAR}' or --token arg) is correct and valid. ***\n")
                try:
                    print(f"Discogs API Response: {response.json()}")
                except json.JSONDecodeError:
                    print(f"Discogs API Response (non-JSON): {response.text}")
                return None

            response.raise_for_status()
            data = response.json()
            releases = data.get('releases', [])
            if not releases:
                print("No releases found on this page or end of collection.")
                break

            all_releases.extend(releases)
            print(f"Fetched {len(releases)} releases. Total: {len(all_releases)}")

            if 'pagination' in data and 'urls' in data['pagination'] and 'next' in data['pagination']['urls']:
                current_url = data['pagination']['urls']['next']
                page += 1
                print("Moving to next page...")
            else:
                print("No more pages found.")
                current_url = None

            time.sleep(REQUEST_DELAY)

        except requests.exceptions.Timeout:
             print(f"\nError: Request timed out while fetching page {page}.")
             return None
        except requests.exceptions.RequestException as e:
            print(f"\nError fetching collection data: {e}")
            if response is not None:
                print(f"Response status: {response.status_code}, Response text: {response.text}")
            return None
        except json.JSONDecodeError:
            print("\nError decoding JSON response from Discogs.")
            if response is not None:
                 print(f"Response text: {response.text}")
            return None

    print(f"\nFinished fetching. Total releases found: {len(all_releases)}")
    return all_releases

def format_collection_data(releases):
    """Formats the raw Discogs data into the desired collection.json structure."""
    print("\nFormatting collection data...")
    collection = []
    missing_data_count = 0

    if not releases:
        print("Warning: No releases data passed to format_collection_data.")
        return []

    # --- REMOVED DEBUGGING PRINT OF FIRST ITEM ---

    for i, release in enumerate(releases):
        basic_info = release.get('basic_information')

        if not basic_info:
            # --- KEPT DEBUGGING PRINT FOR MISSING basic_info ---
            print(f"\n--- DEBUG: 'basic_information' key missing in release index {i} ---")
            try:
                print(json.dumps(release, indent=2))
            except TypeError as e:
                print(f"Could not JSON dump release: {e}")
                print("Raw object:", release)
            print("--- END DEBUG ---\n")
            # --- END DEBUGGING PRINT ---
            print(f"Warning: Missing 'basic_information' structure in release object index {i}. Skipping.")
            missing_data_count += 1
            continue

        # --- CORRECTED DATA EXTRACTION ---
        release_id = basic_info.get('id')
        title = basic_info.get('title')
        artists = basic_info.get('artists', [])
        artist_names = [artist.get('name', '').replace(' (2)', '').strip() for artist in artists if artist.get('name')]
        artist_name = ", ".join(artist_names) if artist_names else 'Unknown Artist'
        cover_image_url = basic_info.get('cover_image')
        # REMOVED: discogs_web_url_path = basic_info.get('uri') # This key doesn't exist here

        # --- VALIDATE EXTRACTED DATA (excluding web path now) ---
        if not all([release_id, title, artist_name != 'Unknown Artist', cover_image_url]):
            print(f"Warning: Missing essential data (ID:{release_id}, Title:{title}, Artist:{artist_name}, Cover:{cover_image_url}) after extraction for release index {i}. Skipping.")
            missing_data_count += 1
            continue

        # --- CONSTRUCT Discogs web URL using release_id ---
        # Ensure release_id is usable in the URL
        if not isinstance(release_id, (int, str)) or int(release_id) <= 0:
            print(f"Warning: Invalid release ID ({release_id}) found for item index {i}. Skipping.")
            missing_data_count +=1
            continue
        full_discogs_url = f"https://www.discogs.com/release/{release_id}"
        # -----------------------------------------------------

        collection.append({
            "artist": artist_name,
            "title": title,
            "release_id": release_id,
            "image_original_url": cover_image_url,
            "image": f"covers/{release_id}.jpg",
            "discogs_url": full_discogs_url
        })
        # --- END CORRECTED DATA EXTRACTION & APPEND ---

    if missing_data_count > 0:
         total_processed = len(releases)
         print(f"\nWarning: Skipped {missing_data_count} out of {total_processed} fetched releases due to missing data or structure problems during formatting.")
    elif releases:
         print("\nAll fetched releases formatted successfully.")

    print(f"Result: Formatted {len(collection)} releases for collection.json.")
    return collection

def save_collection_json(collection_data, filename="collection.json"):
    """Saves the formatted data to a JSON file."""
    if not collection_data:
        print(f"\nNo valid collection data was formatted. Skipping save to {filename}.")
        return False

    print(f"\nSaving {len(collection_data)} formatted items to {filename}...")
    try:
        with open(filename, 'w', encoding='utf-8') as f:
            json.dump(collection_data, f, indent=2, ensure_ascii=False)
        print(f"Successfully saved {filename}.")
        return True
    except IOError as e:
        print(f"Error saving {filename}: {e}")
        return False

def download_cover_art(collection_data, covers_dir="covers", token=None):
    """Downloads cover art for each release in the collection."""
    if not collection_data:
        print("\nNo collection data provided for downloading covers. Skipping downloads.")
        return

    print(f"\nStarting cover art download process to '{covers_dir}' directory...")
    if not os.path.exists(covers_dir):
        print(f"Creating directory: {covers_dir}")
        os.makedirs(covers_dir)

    headers = {"User-Agent": USER_AGENT}
    if token:
        headers["Authorization"] = f"Discogs token={token}"

    downloaded_count = 0
    skipped_count = 0
    error_count = 0
    total_items_in_list = len(collection_data)

    print(f"Attempting to download covers for {total_items_in_list} items listed in formatted data...")

    for i, item in enumerate(collection_data):
        release_id = item.get('release_id')
        image_url = item.get('image_original_url')
        local_path = os.path.join(covers_dir, f"{release_id}.jpg")

        print(f"\rProcessing cover {i+1}/{total_items_in_list} (ID: {release_id})... ", end="")

        if not release_id or not image_url:
            skipped_count += 1
            continue

        if os.path.exists(local_path):
            skipped_count += 1
            continue

        if 'spacer.gif' in image_url or 'default.png' in image_url or 'default.jpg' in image_url:
            skipped_count += 1
            continue

        try:
            response = requests.get(image_url, headers=headers, stream=True, timeout=30)
            response.raise_for_status()

            content_type = response.headers.get('content-type')
            if not content_type or not content_type.startswith('image/'):
                skipped_count += 1
                continue

            with open(local_path, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    f.write(chunk)
            downloaded_count += 1
            time.sleep(REQUEST_DELAY)

        except requests.exceptions.Timeout:
            print(f"\n  ERROR: Timeout downloading cover for ID {release_id} from {image_url}")
            error_count +=1
            time.sleep(REQUEST_DELAY)
        except requests.exceptions.RequestException as e:
            print(f"\n  ERROR: Failed downloading cover for ID {release_id} from {image_url}: {e}")
            error_count += 1
            if os.path.exists(local_path):
                 try:
                     os.remove(local_path)
                 except OSError as remove_error:
                     print(f"    Warning: Could not remove partial file {local_path}: {remove_error}")
            time.sleep(REQUEST_DELAY)

    print() # Newline after progress
    print("\n--- Cover Download Summary ---")
    print(f"Successfully downloaded: {downloaded_count}")
    print(f"Skipped (exists/no URL/default/not image): {skipped_count}")
    print(f"Errors during download: {error_count}")
    print(f"Total items processed: {downloaded_count + skipped_count + error_count} / {total_items_in_list}")
    print("----------------------------")


# --- Main Execution Logic ---
if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Fetch Discogs collection data and cover art for Rekkids.",
        formatter_class=argparse.RawTextHelpFormatter
        )
    parser.add_argument("username", help="Your Discogs username.")
    parser.add_argument(
        "--token",
        help=f"Your Discogs Personal Access Token.\n"
             f"Overrides the {TOKEN_ENV_VAR} environment variable if both are set.\n"
             "Generate a token at: https://www.discogs.com/settings/developers",
        default=None
        )
    parser.add_argument("--skip-fetch", action="store_true",
                        help="Skip fetching data from Discogs API.\n"
                             "Requires an existing collection.json for downloads.")
    parser.add_argument("--skip-download", action="store_true",
                        help="Skip downloading cover art.")
    parser.add_argument("--output-json", default="collection.json",
                        help="Filename for the output JSON data (default: collection.json).")
    parser.add_argument("--covers-dir", default="covers",
                        help="Directory to save cover art (default: covers).")
    parser.add_argument("--user-agent", default=USER_AGENT,
                        help=f"Custom User-Agent string for Discogs API requests.\n(default: \"{USER_AGENT}\")")

    args = parser.parse_args()

    effective_token = None
    token_source = None
    if args.token:
        effective_token = args.token
        token_source = "command line argument (--token)"
    else:
        env_token = os.environ.get(TOKEN_ENV_VAR)
        if env_token:
            effective_token = env_token
            token_source = f"environment variable ({TOKEN_ENV_VAR})"
        else:
            token_source = "not found"

    if not args.skip_fetch and not effective_token:
        print("\n*** ERROR: Discogs API token is required to fetch collection data. ***")
        print(f"Please provide it using the --token argument or set the {TOKEN_ENV_VAR} environment variable.")
        sys.exit("Token missing. Exiting.")
    elif effective_token:
         print(f"Using Discogs token from: {token_source}")
    elif args.skip_fetch:
         print("Note: Skipping fetch, no token check needed for this step.")

    if args.user_agent != USER_AGENT:
        USER_AGENT = args.user_agent
        print(f"Using custom User-Agent: {USER_AGENT}")
    else:
        print(f"Using default User-Agent: {USER_AGENT}")

    collection_data = None

    if not args.skip_fetch:
        raw_releases = get_collection(args.username, effective_token)
        if raw_releases is None:
            sys.exit("Failed to fetch collection data from Discogs. Exiting.")

        collection_data = format_collection_data(raw_releases)
        # Save even if collection_data is empty, to represent an empty collection correctly
        save_collection_json(collection_data, args.output_json)

    else:
        print(f"\nSkipping API fetch. Attempting to load data from {args.output_json}...")
        if os.path.exists(args.output_json):
            try:
                with open(args.output_json, 'r', encoding='utf-8') as f:
                    collection_data = json.load(f)
                if isinstance(collection_data, list):
                     print(f"Successfully loaded {len(collection_data)} items from {args.output_json}.")
                else:
                     sys.exit(f"Error: Content of {args.output_json} is not a valid JSON list. Exiting.")
            except (IOError, json.JSONDecodeError) as e:
                sys.exit(f"Error loading or parsing {args.output_json}: {e}. Exiting.")
        else:
            sys.exit(f"Error: {args.output_json} not found and --skip-fetch was used. Cannot proceed. Exiting.")

    if not args.skip_download:
        if collection_data is not None: # Check if data exists (could be empty list [])
             download_cover_art(collection_data, args.covers_dir, effective_token)
        else:
             print("\nNo collection data available to download covers (fetch/load failed or formatting issue).")
    else:
        print("\nSkipping cover art download as requested.")

    print("\nRekkids data processing finished.")
    if not args.skip_fetch:
        print(f"Collection data (potentially) saved in: {args.output_json}")
    if not args.skip_download and collection_data is not None:
        print(f"Cover images (potentially) saved in: {args.covers_dir}")
    elif collection_data is None:
         print("No collection data was successfully processed or loaded.")

    print("\nYou can now open index.html in your browser (or deploy the files).")